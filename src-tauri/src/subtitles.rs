use std::{fs, path::Path};

use serde_json::{json, Value};

struct Cue {
    start: u64,
    end: u64,
    text: String,
}

pub fn capabilities() -> Value {
    json!({ "id": "subtitle:convert", "operation": "convert", "label": "Convert subtitles", "category": "subtitle",
        "inputs": ["srt", "vtt"], "outputs": ["srt", "vtt", "txt"], "backend": "rust-subtitles",
        "available": true, "batch": true, "preservesMetadata": false, "options": {},
        "warning": "Cue text and timing retained; styling and cue settings are not preserved. TXT omits timestamps and markup." })
}

fn stamp(value: &str) -> Result<u64, String> {
    let parts = value.trim().split([',', '.']).collect::<Vec<_>>();
    if parts.len() != 2 || parts[1].len() != 3 {
        return Err("Invalid subtitle timestamp".into());
    }
    let fields = parts[0].split(':').collect::<Vec<_>>();
    if !(2..=3).contains(&fields.len())
        || fields
            .iter()
            .any(|part| part.len() != 2 || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("Invalid subtitle timestamp".into());
    }
    let numbers = fields
        .iter()
        .map(|part| {
            part.parse::<u64>()
                .map_err(|_| "Invalid subtitle timestamp".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (hours, minutes, seconds) = if numbers.len() == 3 {
        (numbers[0], numbers[1], numbers[2])
    } else {
        (0, numbers[0], numbers[1])
    };
    if minutes > 59 || seconds > 59 {
        return Err("Invalid subtitle timestamp".into());
    }
    (hours * 3600 + minutes * 60 + seconds)
        .checked_mul(1000)
        .and_then(|time| time.checked_add(parts[1].parse::<u64>().ok()?))
        .ok_or("Subtitle timestamp is too large".into())
}

fn parse(source: &str, format: &str) -> Result<Vec<Cue>, String> {
    let normalized = source
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let normalized = normalized.trim();
    let body = if format == "vtt" {
        let first_line = normalized.lines().next().unwrap_or_default();
        if !first_line.starts_with("WEBVTT") {
            return Err("Missing WEBVTT header".into());
        }
        normalized[first_line.len()..].trim()
    } else if format == "srt" {
        normalized
    } else {
        return Err("Unsupported subtitle format".into());
    };
    if body.is_empty() {
        return Ok(Vec::new());
    }
    let mut cues = Vec::new();
    for block in body.split("\n\n") {
        if format == "vtt"
            && ["NOTE", "STYLE", "REGION"]
                .iter()
                .any(|name| block.starts_with(name))
        {
            continue;
        }
        let lines = block.lines().collect::<Vec<_>>();
        let timing_index = lines
            .iter()
            .position(|line| line.contains("-->"))
            .ok_or("Invalid subtitle cue")?;
        if timing_index > 1 {
            return Err("Invalid subtitle cue".into());
        }
        let timing = lines[timing_index].split("-->").collect::<Vec<_>>();
        if timing.len() != 2 {
            return Err("Invalid subtitle timing".into());
        }
        let start = stamp(timing[0])?;
        let end = stamp(
            timing[1]
                .split_whitespace()
                .next()
                .ok_or("Invalid subtitle timing")?,
        )?;
        if end < start {
            return Err("Subtitle ends before it starts".into());
        }
        cues.push(Cue {
            start,
            end,
            text: lines[timing_index + 1..].join("\n"),
        });
        if cues.len() > 100_000 {
            return Err("Too many subtitle cues".into());
        }
    }
    Ok(cues)
}

fn time(value: u64, separator: char) -> String {
    format!(
        "{:02}:{:02}:{:02}{}{:03}",
        value / 3_600_000,
        value / 60_000 % 60,
        value / 1000 % 60,
        separator,
        value % 1000
    )
}

pub fn convert(path: &Path, target: &str) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > 16 * 1024 * 1024 {
        return Err("Subtitle exceeds 16 MiB".into());
    }
    let source = fs::read_to_string(path).map_err(|_| "Subtitle must be UTF-8")?;
    let input = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let cues = parse(&source, &input)?;
    let result = match target {
        "txt" => {
            cues.iter()
                .map(|cue| strip_tags(&cue.text))
                .collect::<Vec<_>>()
                .join("\n\n")
                + "\n"
        }
        "srt" | "vtt" => {
            let mut output = if target == "vtt" {
                "WEBVTT\n\n".to_string()
            } else {
                String::new()
            };
            for (index, cue) in cues.iter().enumerate() {
                if index > 0 {
                    output.push_str("\n\n");
                }
                if target == "srt" {
                    output.push_str(&format!("{}\n", index + 1));
                }
                let separator = if target == "srt" { ',' } else { '.' };
                output.push_str(&format!(
                    "{} --> {}\n{}",
                    time(cue.start, separator),
                    time(cue.end, separator),
                    cue.text
                ));
            }
            output.push('\n');
            output
        }
        _ => return Err("Unsupported subtitle output".into()),
    };
    Ok(result.into_bytes())
}

fn strip_tags(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for character in value.chars() {
        if character == '<' {
            in_tag = true;
        } else if character == '>' && in_tag {
            in_tag = false;
        } else if !in_tag {
            output.push(character);
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_cues_and_rejects_invalid_timing() {
        let cues = parse("1\n00:00:01,000 --> 00:00:02,500\nHello", "srt").unwrap();
        assert_eq!(time(cues[0].end, '.'), "00:00:02.500");
        assert!(parse("00:00:03,000 --> 00:00:02,000\nBad", "srt").is_err());
    }
}
