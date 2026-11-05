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
}

const INPUTS: &[(&str, &str)] = &[
    ("txt", "markdown+hard_line_breaks-raw_html-raw_tex"),
    ("md", "markdown-raw_html-raw_tex"),
    ("html", "html-raw_html"),
    ("docx", "docx"),
    ("epub", "epub"),
    ("rtf", "rtf"),
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
        let mut supported_readers = Vec::new();
        for &(extension, reader) in INPUTS {
            let base = reader.split(['+', '-']).next().unwrap_or(reader);
            if !readers.lines().any(|line| line.trim() == base) {
                continue;
            }
            let input = match extension {
                "docx" | "epub"
                    if supported_writers
                        .iter()
                        .any(|value: &String| value == extension) =>
                {
                    directory.join(format!("output.{extension}"))
                }
                "rtf" => {
                    let path = directory.join("input.rtf");
                    fs::write(&path, "{\\rtf1\\ansi Santra}").ok()?;
                    path
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
        Some(DocumentBackend {
            path: Some(path),
            readers: supported_readers,
            writers: supported_writers,
        })
    })()
    .unwrap_or_default();
    let _ = fs::remove_dir_all(directory);
    result
}

impl DocumentBackend {
    pub fn info(&self) -> Value {
        json!({ "available": self.path.is_some() && !self.readers.is_empty() && !self.writers.is_empty(),
            "readers": self.readers, "writers": self.writers })
    }

    pub fn supports(&self, input: &str, output: &str) -> bool {
        self.path.is_some()
            && self.readers.iter().any(|value| value == input)
            && self.writers.iter().any(|value| value == output)
    }

    pub fn capabilities(&self) -> Vec<Value> {
        vec![
            json!({ "id": "document:convert", "operation": "convert", "label": "Convert documents", "category": "document",
            "inputs": self.readers, "outputs": self.writers, "backend": "pandoc", "available": self.path.is_some() && !self.readers.is_empty() && !self.writers.is_empty(),
            "batch": true, "preservesMetadata": false, "options": {},
            "warning": "Sandboxed conversion, 16 MiB input limit. Complex layout and metadata may be lost; external resources are blocked." }),
        ]
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
        if extension == "rtf" && !signature[..count].starts_with(b"{\\rtf") {
            return Err("Invalid RTF signature".into());
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
