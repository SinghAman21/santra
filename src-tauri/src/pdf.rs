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
pub struct PdfBackend {
    qpdf: Option<PathBuf>,
    poppler: Option<PathBuf>,
}

pub fn detect(overrides: &HashMap<String, String>) -> PdfBackend {
    let qpdf = overrides
        .get("qpdf")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("qpdf"));
    let poppler = overrides
        .get("poppler")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("pdftoppm"));
    let mut qpdf_probe = Command::new(&qpdf);
    qpdf_probe.arg("--version");
    let qpdf_available = crate::media::captured(qpdf_probe, Duration::from_secs(5), || false)
        .is_ok_and(|output| output.contains("qpdf"));
    let mut poppler_probe = Command::new(&poppler);
    poppler_probe.arg("-v");
    let poppler_available = crate::media::captured(poppler_probe, Duration::from_secs(5), || false)
        .is_ok_and(|output| output.contains("pdftoppm"));
    PdfBackend {
        qpdf: qpdf_available.then_some(qpdf),
        poppler: poppler_available.then_some(poppler),
    }
}

impl PdfBackend {
    pub fn info(&self) -> HashMap<String, Value> {
        HashMap::from([
            ("qpdf".into(), json!({ "available": self.qpdf.is_some() })),
            (
                "poppler".into(),
                json!({ "available": self.poppler.is_some() }),
            ),
        ])
    }

    pub fn supports(&self, operation: &str, output: &str) -> bool {
        if operation == "render" {
            self.poppler.is_some() && ["png", "jpg"].contains(&output)
        } else {
            self.qpdf.is_some()
                && output == "pdf"
                && ["compress", "pdf-extract", "pdf-merge", "pdf-rotate"].contains(&operation)
        }
    }

    pub fn capabilities(&self) -> Vec<Value> {
        ["compress", "pdf-extract", "pdf-merge", "pdf-rotate", "render"].iter().map(|operation| {
            let outputs = if *operation == "render" { vec!["png", "jpg"] } else { vec!["pdf"] };
            json!({ "id": format!("pdf:{operation}"), "operation": operation, "label": operation.replace('-', " "),
                "category": "pdf", "inputs": ["pdf"], "outputs": outputs,
                "backend": if *operation == "render" { "poppler" } else { "qpdf" },
                "available": outputs.iter().any(|output| self.supports(operation, output)),
                "batch": *operation != "pdf-merge", "preservesMetadata": *operation != "pdf-merge",
                "options": {}, "warning": if *operation == "compress" { "Structural compression may not reduce file size." } else { "Processed locally; fonts and page appearance depend on the source PDF." } })
        }).collect()
    }

    pub fn run(
        &self,
        input: &Path,
        output: &Path,
        operation: &str,
        format: &str,
        options: &Value,
        cancelled: impl Fn() -> bool,
    ) -> Result<(), String> {
        if !self.supports(operation, format) {
            return Err("PDF route is unavailable".into());
        }
        let mut bytes = [0_u8; 1024];
        let count = File::open(input)
            .map_err(|error| error.to_string())?
            .read(&mut bytes)
            .map_err(|error| error.to_string())?;
        if !bytes[..count].windows(5).any(|window| window == b"%PDF-") {
            return Err("PDF signature is missing".into());
        }
        if fs::metadata(input)
            .map_err(|error| error.to_string())?
            .len()
            > 256 * 1024 * 1024
        {
            return Err("PDF exceeds 256 MiB".into());
        }
        if operation == "render" {
            let page = integer(options, "page", 1, 1, 100_000)?;
            let dpi = integer(options, "dpi", 300, 36, 600)?;
            let path = self.poppler.as_ref().ok_or("Poppler is unavailable")?;
            let mut command = Command::new(path);
            let prefix = output.to_string_lossy().to_string();
            command.args([
                "-f",
                &page.to_string(),
                "-l",
                &page.to_string(),
                "-singlefile",
                "-r",
                &dpi.to_string(),
                if format == "png" { "-png" } else { "-jpeg" },
            ]);
            command.arg(input).arg(&prefix);
            crate::media::captured(command, Duration::from_secs(120), cancelled)
                .map_err(safe_error)?;
            let generated = PathBuf::from(format!(
                "{prefix}.{}",
                if format == "png" { "png" } else { "jpg" }
            ));
            fs::rename(generated, output).map_err(|error| error.to_string())?;
            return Ok(());
        }
        let path = self.qpdf.as_ref().ok_or("qpdf is unavailable")?;
        let mut command = Command::new(path);
        match operation {
            "compress" => {
                command.args([
                    "--object-streams=generate",
                    "--stream-data=compress",
                    "--recompress-flate",
                ]);
                command.arg(input).arg(output);
            }
            "pdf-rotate" => {
                let angle = integer(options, "angle", 90, 90, 270)?;
                if ![90, 180, 270].contains(&angle) {
                    return Err("Invalid PDF rotation angle".into());
                }
                let pages = pages(options)?;
                command
                    .arg(input)
                    .arg(output)
                    .arg(format!("--rotate=+{angle}:{pages}"));
            }
            "pdf-extract" => {
                command
                    .arg("--empty")
                    .arg("--pages")
                    .arg(input)
                    .arg(pages(options)?)
                    .arg("--")
                    .arg(output);
            }
            "pdf-merge" => {
                let inputs = options
                    .get("inputs")
                    .and_then(Value::as_array)
                    .ok_or("Missing PDF inputs")?;
                if inputs.len() < 2 || inputs.len() > 100 {
                    return Err("Select 2–100 PDFs to merge".into());
                }
                command.args(["--empty", "--pages"]);
                for value in inputs {
                    let path = value.as_str().ok_or("Invalid PDF input")?;
                    if Path::new(path)
                        .extension()
                        .and_then(|extension| extension.to_str())
                        != Some("pdf")
                    {
                        return Err("Merge inputs must be PDFs".into());
                    }
                    command.arg(path);
                }
                command.arg("--").arg(output);
            }
            _ => return Err("Unsupported PDF operation".into()),
        }
        crate::media::captured(command, Duration::from_secs(300), cancelled).map_err(safe_error)?;
        Ok(())
    }
}

fn integer(options: &Value, key: &str, default: u32, min: u32, max: u32) -> Result<u32, String> {
    let value = match options.get(key) {
        None => default,
        Some(Value::Number(number)) => u32::try_from(number.as_u64().ok_or("Invalid PDF option")?)
            .map_err(|_| "Invalid PDF option")?,
        Some(Value::String(value)) => value.parse::<u32>().map_err(|_| "Invalid PDF option")?,
        _ => return Err("Invalid PDF option".into()),
    };
    if !(min..=max).contains(&value) {
        return Err(format!("Invalid {key}"));
    }
    Ok(value)
}

fn pages(options: &Value) -> Result<String, String> {
    let value = options
        .get("pages")
        .and_then(Value::as_str)
        .unwrap_or("1-z");
    if value.is_empty()
        || value.len() > 200
        || !value
            .chars()
            .all(|character| character.is_ascii_digit() || [',', '-', 'z'].contains(&character))
    {
        return Err("Invalid PDF page range".into());
    }
    Ok(value.into())
}

fn safe_error(error: String) -> String {
    if error == "Cancelled" || error == "Local media backend timed out" {
        error
    } else {
        "Local PDF backend failed; check whether the PDF is valid and supported".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_a_local_pdf_with_poppler_when_available() {
        let backend = detect(&Default::default());
        if !backend.supports("render", "png") {
            return;
        }
        let directory =
            std::env::temp_dir().join(format!("santra-pdf-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let input = directory.join("page.pdf");
        let output = directory.join("page.tmp");
        let mut pdf = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for object in [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R >>",
            "<< /Length 0 >>\nstream\n\nendstream",
        ] {
            offsets.push(pdf.len());
            pdf.extend_from_slice(
                format!("{} 0 obj\n{object}\nendobj\n", offsets.len()).as_bytes(),
            );
        }
        let start = pdf.len();
        pdf.extend_from_slice(b"xref\n0 5\n0000000000 65535 f \n");
        for offset in offsets {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n").as_bytes(),
        );
        fs::write(&input, pdf).unwrap();
        backend
            .run(
                &input,
                &output,
                "render",
                "png",
                &json!({ "page": 1, "dpi": 72 }),
                || false,
            )
            .unwrap();
        assert!(fs::read(&output).unwrap().starts_with(b"\x89PNG"));
        fs::remove_dir_all(directory).unwrap();
    }
}
