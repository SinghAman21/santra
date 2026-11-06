use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use serde_json::{json, Value};

#[derive(Clone, Default)]
pub struct DocumentBackend {
    path: Option<PathBuf>,
    readers: Vec<String>,
    writers: Vec<String>,
    pairs: Vec<(String, String)>,
}

const INPUTS: &[(&str, &str)] = &[
    ("txt", "markdown+hard_line_breaks-raw_html-raw_tex"),
    ("md", "markdown-raw_html-raw_tex"),
    ("html", "html-raw_html"),
    ("docx", "docx"),
    ("epub", "epub"),
];
const OUTPUTS: &[(&str, &str)] = &[
    ("txt", "plain"),
    ("md", "commonmark"),
    ("html", "html5"),
    ("docx", "docx"),
    ("epub", "epub"),
];

fn probe(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(path);
    command.args(args);
    crate::media::captured(command, Duration::from_secs(10), || false).ok()
}

pub fn detect(overrides: &HashMap<String, String>) -> DocumentBackend {
    let path = overrides
        .get("pandoc")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("pandoc"));
    let Some(version) = probe(&path, &["--version"]) else {
        return DocumentBackend::default();
    };
    if !version.contains("pandoc")
        || !probe(&path, &["--help"]).is_some_and(|help| help.contains("--sandbox"))
    {
        return DocumentBackend::default();
    }
    let readers = probe(&path, &["--list-input-formats"]).unwrap_or_default();
    let writers = probe(&path, &["--list-output-formats"]).unwrap_or_default();
    let directory =
        std::env::temp_dir().join(format!("santra-pandoc-probe-{}", uuid::Uuid::new_v4()));
    if fs::create_dir(&directory).is_err() {
        return DocumentBackend::default();
    }
    let result = (|| {
        let source = directory.join("input.txt");
        fs::write(&source, "Santra local format probe\n").ok()?;
        let mut supported_writers = Vec::new();
        for &(extension, writer) in OUTPUTS {
            if !writers.lines().any(|line| line.trim() == writer) {
                continue;
            }
            let output = directory.join(format!("output.{extension}"));
            let mut command = Command::new(&path);
            command
                .args([
                    "--sandbox",
                    "--from=markdown-raw_html-raw_tex",
                    &format!("--to={writer}"),
                    "--output",
                ])
                .arg(&output)
                .arg("--")
                .arg(&source);
            if crate::media::captured(command, Duration::from_secs(15), || false).is_ok()
                && output.is_file()
            {
                supported_writers.push(extension.into());
            }
        }
        // Generate controlled probe fixtures when sandboxed binary writers are
        // unavailable. Only the fixed local probe text is passed to this step;
        // all conversions of user documents still require --sandbox.
        for (extension, writer) in [("docx", "docx"), ("epub", "epub")] {
            let fixture = directory.join(format!("output.{extension}"));
            if !fixture.is_file() && writers.lines().any(|line| line.trim() == writer) {
                let mut command = Command::new(&path);
                command
                    .args([
                        "--from=markdown-raw_html-raw_tex",
                        &format!("--to={writer}"),
                        "--output",
                    ])
                    .arg(&fixture)
                    .arg("--")
                    .arg(&source);
                let _ = crate::media::captured(command, Duration::from_secs(15), || false);
            }
        }
        let mut supported_readers = Vec::new();
        for &(extension, reader) in INPUTS {
            let base = reader.split(['+', '-']).next().unwrap_or(reader);
            if !readers.lines().any(|line| line.trim() == base) {
                continue;
            }
            let input = match extension {
                "docx" | "epub" if directory.join(format!("output.{extension}")).is_file() => {
                    directory.join(format!("output.{extension}"))
                }
                "docx" | "epub" => continue,
                _ => source.clone(),
            };
            let mut command = Command::new(&path);
            command
                .args(["--sandbox", &format!("--from={reader}"), "--to=plain", "--"])
                .arg(&input);
            if crate::media::captured(command, Duration::from_secs(15), || false).is_ok() {
                supported_readers.push(extension.into());
            }
        }
        fs::write(
            directory.join("input.html"),
            "<p>Santra local format probe</p>",
        )
        .ok()?;
        let mut pairs = Vec::new();
        for &(input_ext, reader) in INPUTS {
            if !supported_readers.iter().any(|value| value == input_ext) {
                continue;
            }
            let input = match input_ext {
                "docx" | "epub" => directory.join(format!("output.{input_ext}")),
                "html" => directory.join("input.html"),
                _ => source.clone(),
            };
            if !input.is_file() {
                continue;
            }
            for &(output_ext, writer) in OUTPUTS {
                if input_ext == output_ext
                    || !supported_writers.iter().any(|value| value == output_ext)
                {
                    continue;
                }
                let output = directory.join(format!("pair-{input_ext}-{output_ext}"));
                let mut command = Command::new(&path);
                command
                    .args([
                        "--sandbox",
                        &format!("--from={reader}"),
                        &format!("--to={writer}"),
                        "--output",
                    ])
                    .arg(&output)
                    .arg("--")
                    .arg(&input);
                if crate::media::captured(command, Duration::from_secs(15), || false).is_ok()
                    && fs::metadata(&output).is_ok_and(|m| m.is_file() && m.len() > 0)
                {
                    pairs.push((input_ext.into(), output_ext.into()));
                }
            }
        }
        Some(DocumentBackend {
            path: Some(path),
            readers: supported_readers,
            writers: supported_writers,
            pairs,
        })
    })()
    .unwrap_or_default();
    let _ = fs::remove_dir_all(directory);
    result
}

impl DocumentBackend {
    pub fn info(&self) -> Value {
        json!({ "available": self.path.is_some() && !self.pairs.is_empty(),
            "readers": self.readers, "writers": self.writers })
    }

    pub fn supports(&self, input: &str, output: &str) -> bool {
        self.path.is_some()
            && self
                .pairs
                .iter()
                .any(|(reader, writer)| reader == input && writer == output)
    }

    pub fn capabilities(&self) -> Vec<Value> {
        INPUTS.iter().filter_map(|(input, _)| {
            let outputs: Vec<&str> = self.pairs.iter().filter(|(reader, _)| reader == input)
                .map(|(_, writer)| writer.as_str()).collect();
            if outputs.is_empty() { return None; }
            Some(json!({ "id": format!("document:convert:{input}"), "operation": "convert", "label": "Convert documents", "category": "document",
                "inputs": [input], "outputs": outputs, "backend": "pandoc", "available": true,
                "batch": true, "preservesMetadata": false, "options": {},
                "warning": "Conversion may lose page layout, fonts, images and metadata; TXT retains text only." }))
        }).collect()
    }

    pub fn run(
        &self,
        input: &Path,
        output: &Path,
        format: &str,
        cancelled: impl Fn() -> bool,
    ) -> Result<(), String> {
        let extension = input
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !self.supports(&extension, format) {
            return Err("Document route is unavailable".into());
        }
        let info = fs::metadata(input).map_err(|error| error.to_string())?;
        if !info.is_file() || info.len() > 16 * 1024 * 1024 {
            return Err("Document exceeds 16 MiB".into());
        }
        let mut signature = [0_u8; 8];
        let count = File::open(input)
            .map_err(|error| error.to_string())?
            .read(&mut signature)
            .map_err(|error| error.to_string())?;
        if ["docx", "epub"].contains(&extension.as_str())
            && !signature[..count].starts_with(b"PK\x03\x04")
        {
            return Err("Document signature does not match its extension".into());
        }
        let reader = INPUTS
            .iter()
            .find(|entry| entry.0 == extension)
            .ok_or("Unsupported document input")?
            .1;
        let writer = OUTPUTS
            .iter()
            .find(|entry| entry.0 == format)
            .ok_or("Unsupported document output")?
            .1;
        let mut command = Command::new(self.path.as_ref().ok_or("Pandoc is unavailable")?);
        command
            .args([
                "--sandbox",
                &format!("--from={reader}"),
                &format!("--to={writer}"),
                "--output",
            ])
            .arg(output)
            .arg("--")
            .arg(input);
        crate::media::captured(command, Duration::from_secs(120), cancelled).map_err(|error| {
            if error == "Cancelled" || error == "Local media backend timed out" {
                error
            } else {
                "Local document backend failed; check the input and format".into()
            }
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn advertised_document_routes_are_pairwise_probed() {
        let backend = detect(&HashMap::new());
        if backend.path.is_some() {
            assert!(
                backend.supports("md", "txt"),
                "the local sandbox must convert the Markdown fixture to text"
            );
        }
        for capability in backend.capabilities() {
            let input = capability["inputs"][0].as_str().unwrap();
            for output in capability["outputs"].as_array().unwrap() {
                assert!(backend.supports(input, output.as_str().unwrap()));
                assert_ne!(input, output.as_str().unwrap());
            }
            assert!(!backend.supports(input, "rtf"));
        }
        assert!(!backend.supports("rtf", "txt"));
    }
}
