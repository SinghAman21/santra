use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Component, Path, PathBuf},
};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde_json::{json, Value};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_ENTRY: u64 = 64 * 1024 * 1024;
const MAX_TOTAL: u64 = 128 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;

pub fn capabilities() -> Vec<Value> {
    vec![
        json!({ "id": "archive:create", "operation": "create-archive", "label": "Create archive", "category": "archive",
            "inputs": ["*", "directory"], "outputs": ["zip", "tar", "gz"], "backend": "rust-archive",
            "available": true, "batch": false, "preservesMetadata": false, "options": {},
            "warning": "128 MiB total, 64 MiB per file, 10,000 entries. GZIP accepts one regular file. Links are rejected." }),
        json!({ "id": "archive:extract", "operation": "extract", "label": "Extract archive", "category": "archive",
            "inputs": ["zip", "tar", "gz"], "outputs": ["directory"], "backend": "rust-archive",
            "available": true, "batch": true, "preservesMetadata": false, "options": {},
            "warning": "128 MiB total, 64 MiB per entry. Unsafe paths, links and encrypted entries are rejected." }),
    ]
}

#[derive(Clone)]
struct Entry {
    source: PathBuf,
    relative: PathBuf,
    size: u64,
    directory: bool,
}

fn no_symlink(path: &Path) -> Result<fs::Metadata, String> {
    for ancestor in path.ancestors() {
        if fs::symlink_metadata(ancestor)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Archive paths cannot contain symbolic links".into());
        }
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err("Unsupported archive source entry".into());
    }
    Ok(metadata)
}

fn collect(
    path: &Path,
    relative: &Path,
    depth: u8,
    entries: &mut Vec<Entry>,
    total: &mut u64,
) -> Result<(), String> {
    if depth > 64 || entries.len() >= MAX_ENTRIES {
        return Err("Archive entry or depth limit exceeded".into());
    }
    let metadata = no_symlink(path)?;
    let size = if metadata.is_file() {
        metadata.len()
    } else {
        0
    };
    if size > MAX_ENTRY {
        return Err("Archive source file exceeds 64 MiB".into());
    }
    *total = total.checked_add(size).ok_or("Archive is too large")?;
    if *total > MAX_TOTAL {
        return Err("Archive exceeds 128 MiB".into());
    }
    entries.push(Entry {
        source: path.into(),
        relative: relative.into(),
        size,
        directory: metadata.is_dir(),
    });
    if metadata.is_dir() {
        let mut children = fs::read_dir(path)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            collect(
                &child.path(),
                &relative.join(child.file_name()),
                depth + 1,
                entries,
                total,
            )?;
        }
    }
    Ok(())
}

fn safe_relative(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("Archive entry has an unsafe path".into());
    }
    if path.components().count() > 64 {
        return Err("Archive path depth limit exceeded".into());
    }
    Ok(())
}

fn relative_name(path: &Path) -> Result<String, String> {
    safe_relative(path)?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}

pub fn create(inputs: &[PathBuf], output: &Path, format: &str) -> Result<(), String> {
    if inputs.is_empty() || inputs.len() > 1_000 {
        return Err("Select 1–1,000 archive sources".into());
    }
    let mut entries = Vec::new();
    let mut total = 0;
    let mut roots = std::collections::HashSet::new();
    for path in inputs {
        let name = path.file_name().ok_or("Invalid archive source name")?;
        if !roots.insert(name.to_os_string()) {
            return Err("Archive sources have duplicate names".into());
        }
        collect(path, Path::new(name), 0, &mut entries, &mut total)?;
    }
    if format == "gz" {
        if entries.len() != 1 || entries[0].directory {
            return Err("GZIP accepts one regular file".into());
        }
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .map_err(|error| error.to_string())?;
        let mut encoder = GzEncoder::new(file, Compression::default());
        let mut source = File::open(&entries[0].source).map_err(|error| error.to_string())?;
        if std::io::copy(&mut source, &mut encoder).map_err(|error| error.to_string())?
            != entries[0].size
        {
            return Err("Archive source changed".into());
        }
        encoder
            .finish()
            .map_err(|error| error.to_string())?
            .sync_all()
            .map_err(|error| error.to_string())?;
    } else if format == "zip" {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .map_err(|error| error.to_string())?;
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);
        for entry in &entries {
            let name = relative_name(&entry.relative)?;
            if entry.directory {
                writer
                    .add_directory(format!("{name}/"), options)
                    .map_err(|error| error.to_string())?;
            } else {
                writer
                    .start_file(name, options)
                    .map_err(|error| error.to_string())?;
                let mut source = File::open(&entry.source).map_err(|error| error.to_string())?;
                if std::io::copy(&mut source, &mut writer).map_err(|error| error.to_string())?
                    != entry.size
                {
                    return Err("Archive source changed".into());
                }
            }
        }
        writer
            .finish()
            .map_err(|error| error.to_string())?
            .sync_all()
            .map_err(|error| error.to_string())?;
    } else if format == "tar" {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .map_err(|error| error.to_string())?;
        let mut writer = tar::Builder::new(file);
        for entry in &entries {
            if entry.directory {
                writer
                    .append_dir(&entry.relative, &entry.source)
                    .map_err(|error| error.to_string())?;
            } else {
                let mut source = File::open(&entry.source).map_err(|error| error.to_string())?;
                writer
                    .append_file(&entry.relative, &mut source)
                    .map_err(|error| error.to_string())?;
            }
        }
        writer.finish().map_err(|error| error.to_string())?;
        writer
            .into_inner()
            .map_err(|error| error.to_string())?
            .sync_all()
            .map_err(|error| error.to_string())?;
    } else {
        return Err("Unsupported archive format".into());
    }
    Ok(())
}

fn extract_one<R: Read>(
    reader: &mut R,
    root: &Path,
    relative: &Path,
    declared: u64,
    total: &mut u64,
) -> Result<(), String> {
    safe_relative(relative)?;
    if declared > MAX_ENTRY {
        return Err("Archive entry exceeds 64 MiB".into());
    }
    *total = total.checked_add(declared).ok_or("Archive is too large")?;
    if *total > MAX_TOTAL {
        return Err("Archive exceeds 128 MiB".into());
    }
    let output = root.join(relative);
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .map_err(|error| error.to_string())?;
    let copied = std::io::copy(&mut reader.take(MAX_ENTRY + 1), &mut file)
        .map_err(|error| error.to_string())?;
    if copied != declared {
        return Err("Archive entry size does not match its header".into());
    }
    file.sync_all().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn extract(input: &Path, root: &Path, format: &str) -> Result<(), String> {
    if fs::metadata(input)
        .map_err(|error| error.to_string())?
        .len()
        > MAX_TOTAL
    {
        return Err("Archive exceeds 128 MiB".into());
    }
    fs::create_dir(root).map_err(|error| error.to_string())?;
    let mut total = 0;
    match format {
        "zip" => {
            let mut archive =
                ZipArchive::new(File::open(input).map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
            if archive.len() > MAX_ENTRIES {
                return Err("Too many archive entries".into());
            }
            for index in 0..archive.len() {
                let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
                if entry.encrypted()
                    || entry
                        .unix_mode()
                        .is_some_and(|mode| mode & 0o170000 == 0o120000)
                {
                    return Err("Encrypted or linked archive entries are unsupported".into());
                }
                let relative = entry
                    .enclosed_name()
                    .ok_or("Archive entry has an unsafe path")?;
                safe_relative(&relative)?;
                if entry.is_dir() {
                    fs::create_dir_all(root.join(relative)).map_err(|error| error.to_string())?;
                } else {
                    let size = entry.size();
                    extract_one(&mut entry, root, &relative, size, &mut total)?;
                }
            }
        }
        "tar" => {
            let mut archive =
                tar::Archive::new(File::open(input).map_err(|error| error.to_string())?);
            for (index, item) in archive
                .entries()
                .map_err(|error| error.to_string())?
                .enumerate()
            {
                if index >= MAX_ENTRIES {
                    return Err("Too many archive entries".into());
                }
                let mut entry = item.map_err(|error| error.to_string())?;
                let kind = entry.header().entry_type();
                if !kind.is_file() && !kind.is_dir() {
                    return Err("Linked or special archive entries are unsupported".into());
                }
                let relative = entry
                    .path()
                    .map_err(|error| error.to_string())?
                    .to_path_buf();
                safe_relative(&relative)?;
                if kind.is_dir() {
                    fs::create_dir_all(root.join(relative)).map_err(|error| error.to_string())?;
                } else {
                    let size = entry.size();
                    extract_one(&mut entry, root, &relative, size, &mut total)?;
                }
            }
        }
        "gz" => {
            let stem = input.file_stem().ok_or("Invalid GZIP filename")?;
            let relative = PathBuf::from(stem);
            let mut decoder = GzDecoder::new(File::open(input).map_err(|error| error.to_string())?);
            let output = root.join(&relative);
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output)
                .map_err(|error| error.to_string())?;
            let copied = std::io::copy(
                &mut std::io::Read::by_ref(&mut decoder).take(MAX_ENTRY + 1),
                &mut file,
            )
            .map_err(|error| error.to_string())?;
            if copied > MAX_ENTRY {
                return Err("GZIP output exceeds 64 MiB".into());
            }
            file.sync_all().map_err(|error| error.to_string())?;
        }
        _ => return Err("Unsupported archive format".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_round_trip_and_path_rejection() {
        let root =
            std::env::temp_dir().join(format!("santra-archive-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let source = root.join("hello.txt");
        fs::write(&source, b"hello").unwrap();
        let archive = root.join("hello.zip");
        create(&[source], &archive, "zip").unwrap();
        let output = root.join("out");
        extract(&archive, &output, "zip").unwrap();
        assert_eq!(fs::read(output.join("hello.txt")).unwrap(), b"hello");
        assert!(safe_relative(Path::new("../escape")).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
