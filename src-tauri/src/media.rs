use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct MediaBackend {
    ffmpeg: Option<PathBuf>,
    ffprobe: Option<PathBuf>,
    encoders: String,
    muxers: String,
    demuxers: String,
    filters: String,
}

const VIDEO_INPUTS: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "wmv"];
const AUDIO_INPUTS: &[&str] = &["mp3", "wav", "flac", "ogg", "opus", "m4a", "aiff", "wma"];
const VIDEO_OUTPUTS: &[(&str, &str, &str)] = &[
    ("mp4", "libx264", "mp4"),
    ("mkv", "libx264", "matroska"),
    ("webm", "libvpx-vp9", "webm"),
    ("mov", "libx264", "mov"),
    ("avi", "mpeg4", "avi"),
    ("wmv", "wmv2", "asf"),
];
const AUDIO_OUTPUTS: &[(&str, &str, &str)] = &[
    ("mp3", "libmp3lame", "mp3"),
    ("wav", "pcm_s16le", "wav"),
    ("flac", "flac", "flac"),
    ("ogg", "libvorbis", "ogg"),
    ("opus", "libopus", "ogg"),
    ("m4a", "aac", "ipod"),
    ("aiff", "pcm_s16be", "aiff"),
    ("wma", "wmav2", "asf"),
];

fn has(text: &str, token: &str) -> bool {
    text.split(|part: char| part.is_whitespace() || part == ',')
        .any(|part| part == token)
}

fn color(options: &Value, key: &str, default: &str) -> Result<String, String> {
    let value = match options.get(key) {
        None => default,
        Some(Value::String(value)) => value,
        _ => return Err(format!("Invalid {key}")),
    };
    if value.len() != 7
        || !value.starts_with('#')
        || !value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(format!("Invalid {key}"));
    }
    Ok(format!("0x{}", &value[1..]))
}

fn bounded(options: &Value, key: &str, default: f64, min: f64, max: f64) -> Result<f64, String> {
    let value = match options.get(key) {
        None => default,
        Some(Value::Number(number)) => number.as_f64().ok_or_else(|| format!("Invalid {key}"))?,
        Some(Value::String(value)) => value.parse::<f64>().map_err(|_| format!("Invalid {key}"))?,
        _ => return Err(format!("Invalid {key}")),
    };
    if !value.is_finite() || !(min..=max).contains(&value) {
        return Err(format!("Invalid {key}"));
    }
    Ok(value)
}

fn redact_filter(options: &Value, width: u32, height: u32) -> Result<String, String> {
    let masks = options
        .get("masks")
        .and_then(Value::as_array)
        .ok_or("Missing redaction masks")?;
    if masks.is_empty() || masks.len() > 16 {
        return Err("Select 1–16 redaction masks".into());
    }
    let mut filters = Vec::new();
    for mask in masks {
        if !mask.is_object() {
            return Err("Invalid redaction mask".into());
        }
        let x = bounded(mask, "x", 0.0, 0.0, width as f64)?;
        let y = bounded(mask, "y", 0.0, 0.0, height as f64)?;
        let w = bounded(mask, "width", 0.0, 2.0, width as f64)?;
        let h = bounded(mask, "height", 0.0, 2.0, height as f64)?;
        if [x, y, w, h].iter().any(|value| value.fract() != 0.0)
            || x + w > width as f64
            || y + h > height as f64
        {
            return Err("Redaction mask exceeds video bounds".into());
        }
        let start = bounded(mask, "start", 0.0, 0.0, 604_800.0)?;
        let end = bounded(mask, "end", 604_800.0, 0.0, 604_800.0)?;
        if end <= start {
            return Err("Invalid redaction time range".into());
        }
        let fill = color(mask, "color", "#000000")?;
        let filled = mask
            .get("filled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        if !["rect", "rectangle"].contains(
            &mask
                .get("shape")
                .and_then(Value::as_str)
                .unwrap_or("rect"),
        ) {
            return Err("Redaction shapes need the overlay renderer".into());
        }
        filters.push(format!(
            "drawbox=x={x}:y={y}:w={w}:h={h}:color={fill}:t={}:enable='between(t,{start},{end})'",
            if filled { "fill" } else { "4" }
        ));
    }
    Ok(filters.join(","))
}

fn redact_needs_overlay(options: &Value) -> bool {
    options
        .get("masks")
        .and_then(Value::as_array)
        .is_some_and(|masks| {
            masks.iter().any(|mask| {
                !["rect", "rectangle"].contains(
                    &mask
                        .get("shape")
                        .and_then(Value::as_str)
                        .unwrap_or("rect"),
                ) || !mask
                    .get("filled")
                    .and_then(Value::as_bool)
                    .unwrap_or(true)
            })
        })
}

fn rgba(value: &str) -> Result<[u8; 4], String> {
    if value.len() != 7
        || !value.starts_with('#')
        || !value[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Invalid redaction color".into());
    }
    Ok([
        u8::from_str_radix(&value[1..3], 16).map_err(|_| "Invalid redaction color")?,
        u8::from_str_radix(&value[3..5], 16).map_err(|_| "Invalid redaction color")?,
        u8::from_str_radix(&value[5..7], 16).map_err(|_| "Invalid redaction color")?,
        255,
    ])
}

fn triangle_contains(point: (f64, f64), a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> bool {
    let sign = |p1: (f64, f64), p2: (f64, f64), p3: (f64, f64)| {
        (p1.0 - p3.0) * (p2.1 - p3.1) - (p2.0 - p3.0) * (p1.1 - p3.1)
    };
    let d1 = sign(point, a, b);
    let d2 = sign(point, b, c);
    let d3 = sign(point, c, a);
    let negative = d1 < 0.0 || d2 < 0.0 || d3 < 0.0;
    let positive = d1 > 0.0 || d2 > 0.0 || d3 > 0.0;
    !(negative && positive)
}

fn segment_distance(point: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let length = dx * dx + dy * dy;
    if length == 0.0 {
        return ((point.0 - a.0).powi(2) + (point.1 - a.1).powi(2)).sqrt();
    }
    let t = (((point.0 - a.0) * dx + (point.1 - a.1) * dy) / length).clamp(0.0, 1.0);
    let x = a.0 + t * dx;
    let y = a.1 + t * dy;
    ((point.0 - x).powi(2) + (point.1 - y).powi(2)).sqrt()
}

fn mask_points(mask: &Value, x: u32, y: u32) -> Vec<(f64, f64)> {
    mask.get("points")
        .and_then(Value::as_array)
        .map(|points| {
            points
                .iter()
                .take(2_000)
                .filter_map(|point| {
                    let px = point.get("x").and_then(Value::as_f64)?;
                    let py = point.get("y").and_then(Value::as_f64)?;
                    Some((px - f64::from(x), py - f64::from(y)))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn draw_mask_canvas(mask: &Value, width: u32, height: u32, x: u32, y: u32) -> Result<image::RgbaImage, String> {
    let mut canvas = image::RgbaImage::new(width, height);
    let stroke = mask
        .get("stroke")
        .and_then(Value::as_u64)
        .unwrap_or(4)
        .clamp(1, 64) as f64;
    let filled = mask
        .get("filled")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let pixel = rgba(
        mask.get("color")
            .and_then(Value::as_str)
            .unwrap_or("#000000"),
    )?;
    let paint = image::Rgba(pixel);
    let inside = |px: f64, py: f64| -> bool {
        match mask.get("shape").and_then(Value::as_str).unwrap_or("rect") {
            "circle" => {
                let rx = f64::from(width) / 2.0;
                let ry = f64::from(height) / 2.0;
                if rx < 1.0 || ry < 1.0 {
                    return false;
                }
                let dx = (px - rx) / rx;
                let dy = (py - ry) / ry;
                let distance = (dx * dx + dy * dy).sqrt();
                if filled {
                    distance <= 1.0
                } else {
                    (distance - 1.0).abs() * rx.min(ry) <= stroke
                }
            }
            "triangle" => {
                let mut points = mask_points(mask, x, y);
                if points.len() < 3 {
                    points = vec![
                        (f64::from(width) / 2.0, 0.0),
                        (0.0, f64::from(height)),
                        (f64::from(width), f64::from(height)),
                    ];
                }
                if filled {
                    triangle_contains((px, py), points[0], points[1], points[2])
                } else {
                    [
                        (points[0], points[1]),
                        (points[1], points[2]),
                        (points[2], points[0]),
                    ]
                    .iter()
                    .any(|(a, b)| segment_distance((px, py), *a, *b) <= stroke)
                }
            }
            "path" => {
                let points = mask_points(mask, x, y);
                if points.len() < 2 {
                    return false;
                }
                if filled && points.len() > 2 {
                    let mut hit = false;
                    let mut previous = points[points.len() - 1];
                    for current in &points {
                        if (current.1 > py) != (previous.1 > py)
                            && px
                                < (previous.0 - current.0) * (py - current.1)
                                    / (previous.1 - current.1)
                                    + current.0
                        {
                            hit = !hit;
                        }
                        previous = *current;
                    }
                    hit
                } else {
                    points
                        .windows(2)
                        .any(|pair| segment_distance((px, py), pair[0], pair[1]) <= stroke)
                        || segment_distance((px, py), points[0], points[points.len() - 1]) <= stroke
                }
            }
            _ => {
                if filled {
                    true
                } else {
                    px <= stroke
                        || py <= stroke
                        || px >= f64::from(width) - stroke
                        || py >= f64::from(height) - stroke
                }
            }
        }
    };
    for py in 0..height {
        for px in 0..width {
            if inside(f64::from(px) + 0.5, f64::from(py) + 0.5) {
                canvas.put_pixel(px, py, paint);
            }
        }
    }
    Ok(canvas)
}

struct RedactOverlay {
    path: PathBuf,
    x: u32,
    y: u32,
    start: f64,
    end: f64,
}

fn redact_overlays(
    options: &Value,
    width: u32,
    height: u32,
    directory: &Path,
) -> Result<Vec<RedactOverlay>, String> {
    let masks = options
        .get("masks")
        .and_then(Value::as_array)
        .ok_or("Missing redaction masks")?;
    if masks.is_empty() || masks.len() > 16 {
        return Err("Select 1–16 redaction masks".into());
    }
    let mut overlays = Vec::new();
    for (index, mask) in masks.iter().enumerate() {
        if !mask.is_object() {
            return Err("Invalid redaction mask".into());
        }
        let x = bounded(mask, "x", 0.0, 0.0, width as f64)?;
        let y = bounded(mask, "y", 0.0, 0.0, height as f64)?;
        let w = bounded(mask, "width", 0.0, 2.0, width as f64)?;
        let h = bounded(mask, "height", 0.0, 2.0, height as f64)?;
        if [x, y, w, h].iter().any(|value| value.fract() != 0.0)
            || x + w > width as f64
            || y + h > height as f64
        {
            return Err("Redaction mask exceeds video bounds".into());
        }
        let start = bounded(mask, "start", 0.0, 0.0, 604_800.0)?;
        let end = bounded(mask, "end", 604_800.0, 0.0, 604_800.0)?;
        if end <= start {
            return Err("Invalid redaction time range".into());
        }
        let canvas = draw_mask_canvas(mask, w as u32, h as u32, x as u32, y as u32)?;
        let path = directory.join(format!("mask-{index}.png"));
        canvas
            .save(&path)
            .map_err(|_| "Cannot render redaction mask")?;
        overlays.push(RedactOverlay {
            path,
            x: x as u32,
            y: y as u32,
            start,
            end,
        });
    }
    Ok(overlays)
}


pub(crate) fn captured(
    mut command: Command,
    timeout: Duration,
    cancelled: impl Fn() -> bool,
) -> Result<String, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "Local media backend could not start".to_string())?;
    let stdout = child.stdout.take().ok_or("Media output unavailable")?;
    let stderr = child.stderr.take().ok_or("Media diagnostics unavailable")?;
    let reader = |mut stream: Box<dyn Read + Send>| {
        thread::spawn(move || {
            let mut output = Vec::new();
            let mut buffer = [0_u8; 8192];
            loop {
                let Ok(count) = stream.read(&mut buffer) else {
                    break;
                };
                if count == 0 {
                    break;
                }
                if output.len() < 4_000_000 {
                    output.extend_from_slice(&buffer[..count.min(4_000_000 - output.len())]);
                }
            }
            output
        })
    };
    let out = reader(Box::new(stdout));
    let err = reader(Box::new(stderr));
    let start = Instant::now();
    let status = loop {
        if cancelled() || start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = out.join();
            let _ = err.join();
            return Err(if cancelled() {
                "Cancelled"
            } else {
                "Local media backend timed out"
            }
            .into());
        }
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break status,
            None => thread::sleep(Duration::from_millis(25)),
        }
    };
    let stdout = out.join().map_err(|_| "Media output reader failed")?;
    let stderr = err.join().map_err(|_| "Media diagnostic reader failed")?;
    let output = format!(
        "{}\n{}",
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr)
    );
    if !status.success() {
        return Err(output.chars().take(2000).collect());
    }
    Ok(output)
}

fn probe(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(path);
    command.args(args);
    captured(command, Duration::from_secs(5), || false).ok()
}

pub fn detect(overrides: &std::collections::HashMap<String, String>) -> MediaBackend {
    let ffmpeg = overrides
        .get("ffmpeg")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("ffmpeg"));
    let ffprobe = overrides
        .get("ffprobe")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("ffprobe"));
    if !probe(&ffmpeg, &["-version"]).is_some_and(|output| output.contains("ffmpeg version")) {
        return MediaBackend::default();
    }
    if !probe(&ffprobe, &["-version"]).is_some_and(|output| output.contains("ffprobe version")) {
        return MediaBackend::default();
    }
    MediaBackend {
        ffmpeg: Some(ffmpeg),
        ffprobe: Some(ffprobe),
        encoders: probe(
            Path::new(
                overrides
                    .get("ffmpeg")
                    .filter(|value| !value.is_empty())
                    .map(String::as_str)
                    .unwrap_or("ffmpeg"),
            ),
            &["-hide_banner", "-encoders"],
        )
        .unwrap_or_default(),
        muxers: probe(
            Path::new(
                overrides
                    .get("ffmpeg")
                    .filter(|value| !value.is_empty())
                    .map(String::as_str)
                    .unwrap_or("ffmpeg"),
            ),
            &["-hide_banner", "-muxers"],
        )
        .unwrap_or_default(),
        demuxers: probe(
            Path::new(
                overrides
                    .get("ffmpeg")
                    .filter(|value| !value.is_empty())
                    .map(String::as_str)
                    .unwrap_or("ffmpeg"),
            ),
            &["-hide_banner", "-demuxers"],
        )
        .unwrap_or_default(),
        filters: probe(
            Path::new(
                overrides
                    .get("ffmpeg")
                    .filter(|value| !value.is_empty())
                    .map(String::as_str)
                    .unwrap_or("ffmpeg"),
            ),
            &["-hide_banner", "-filters"],
        )
        .unwrap_or_default(),
    }
}

impl MediaBackend {
    pub fn available(&self) -> bool {
        self.ffmpeg.is_some() && self.ffprobe.is_some()
    }

    pub fn info(&self) -> Value {
        json!({ "available": self.available(), "path": self.ffmpeg.as_ref().map(|path| path.to_string_lossy().to_string()) })
    }

    pub fn waveform(
        &self,
        input: &Path,
        output: &Path,
        cancelled: impl Fn() -> bool,
    ) -> Result<(), String> {
        let extension = input
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !AUDIO_INPUTS.contains(&extension.as_str())
            || !has(&self.demuxers, demuxer(&extension))
            || !has(&self.filters, "showwavespic")
            || !has(&self.encoders, "png")
        {
            return Err("Audio waveform preview is unavailable".into());
        }
        let (_, audio) = self.merge_streams(input, &cancelled)?;
        if audio.is_none() {
            return Err("Audio stream is missing".into());
        }
        let ffmpeg = self.ffmpeg.as_ref().ok_or("FFmpeg is unavailable")?;
        let mut command = Command::new(ffmpeg);
        command
            .args([
                "-hide_banner",
                "-nostdin",
                "-v",
                "error",
                "-n",
                "-protocol_whitelist",
                "file",
                "-f",
                demuxer(&extension),
                "-t",
                "300",
                "-i",
            ])
            .arg(input)
            .args([
                "-filter_complex",
                "showwavespic=s=800x120:colors=0xff5a00",
                "-frames:v",
                "1",
                "-f",
                "image2",
                "-vcodec",
                "png",
            ])
            .arg(output);
        captured(command, Duration::from_secs(20), cancelled).map_err(safe_media_error)?;
        let mut bytes = Vec::new();
        fs::File::open(output)
            .map_err(|_| "Audio waveform was not created")?
            .take(1_000_001)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read audio waveform")?;
        if bytes.len() > 1_000_000 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("Invalid audio waveform preview".into());
        }
        Ok(())
    }

    pub fn preview_details(&self, input: &Path) -> Option<Value> {
        let (video, audio) = self.merge_streams(input, &|| false).ok()?;
        if video.is_null() && audio.is_none() {
            return None;
        }
        let mut command = Command::new(self.ffprobe.as_ref()?);
        command
            .args([
                "-v",
                "error",
                "-protocol_whitelist",
                "file",
                "-show_entries",
                "format=duration:format_tags=title,artist,album,date,comment,description",
                "-of",
                "json",
                "-i",
            ])
            .arg(input);
        let output = captured(command, Duration::from_secs(10), || false).ok()?;
        let data: Value = serde_json::from_str(&output).ok()?;
        let duration = data["format"]["duration"]
            .as_str()
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 604_800.0);
        let mut metadata = serde_json::Map::new();
        if let Some(tags) = data["format"]["tags"].as_object() {
            for (key, value) in tags.iter().take(20) {
                if key.len() <= 64
                    && value.as_str().is_some_and(|text| {
                        text.len() <= 256 && !text.chars().any(char::is_control)
                    })
                {
                    metadata.insert(key.clone(), value.clone());
                }
            }
        }
        Some(
            json!({ "duration": duration, "width": video["width"], "height": video["height"], "metadata": metadata }),
        )
    }

    pub fn preview_video(&self, input: &Path, output: &Path) -> Result<(), String> {
        let extension = input
            .extension()
            .and_then(|part| part.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !self.supports("video", "convert", &extension, "mp4")
            || !has(&self.filters, "scale")
            || !has(&self.filters, "format")
        {
            return Err("Video editor preview requires a local H.264/AAC FFmpeg route".into());
        }
        let (video, _) = self.merge_streams(input, &|| false)?;
        if video.is_null() {
            return Err("Video stream is missing".into());
        }
        let mut command = Command::new(self.ffmpeg.as_ref().ok_or("FFmpeg is unavailable")?);
        command.args(["-hide_banner", "-nostdin", "-v", "error", "-n", "-protocol_whitelist", "file", "-f", demuxer(&extension), "-i"])
            .arg(input).args(["-t", "30", "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
                "-vf", "scale=w=640:h=640:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-c:a", "aac", "-b:a", "96k",
                "-movflags", "+faststart", "-f", "mp4"])
            .arg(output);
        captured(command, Duration::from_secs(90), || false).map_err(safe_media_error)?;
        Ok(())
    }

    fn video_dimensions(
        &self,
        input: &Path,
        cancelled: &impl Fn() -> bool,
    ) -> Result<(u32, u32), String> {
        let ffprobe = self.ffprobe.as_ref().ok_or("FFprobe is unavailable")?;
        let mut command = Command::new(ffprobe);
        command.args([
            "-v",
            "error",
            "-protocol_whitelist",
            "file",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
            "-i",
        ])
        .arg(input);
        let output = captured(command, Duration::from_secs(10), cancelled)
            .map_err(safe_media_error)?;
        let parts = output.trim().split(',').collect::<Vec<_>>();
        if parts.len() != 2 {
            return Err("Cannot inspect video dimensions".into());
        }
        let width = parts[0]
            .parse::<u32>()
            .map_err(|_| "Invalid video dimensions")?;
        let height = parts[1]
            .parse::<u32>()
            .map_err(|_| "Invalid video dimensions")?;
        if width == 0 || height == 0 || width > 16_384 || height > 16_384 {
            return Err("Invalid video dimensions".into());
        }
        Ok((width, height))
    }

    pub fn supports(&self, category: &str, operation: &str, input: &str, output: &str) -> bool {
        if !self.available() {
            return false;
        }
        if (operation == "visualize" && category != "audio")
            || ([
                "redact",
                "gif",
                "snapshot",
                "extract-audio",
                "mute",
                "speed",
                "resize",
                "crop",
                "rotate",
                "flip",
                "crop-resize",
                "rotate-flip",
                "frames-gif",
                "audio-output",
            ]
            .contains(&operation)
                && category != "video")
        {
            return false;
        }
        let inputs = if category == "video" {
            VIDEO_INPUTS
        } else if category == "audio" {
            AUDIO_INPUTS
        } else {
            return false;
        };
        if !inputs.contains(&input) || !has(&self.demuxers, demuxer(input)) {
            return false;
        }
        let output_spec = if (operation == "snapshot" || operation == "frames-gif")
            && category == "video"
            && output == "png"
        {
            Some(("png", "image2pipe"))
        } else if (operation == "gif" || operation == "frames-gif")
            && category == "video"
            && output == "gif"
        {
            Some(("gif", "gif"))
        } else if operation == "visualize" && category == "audio" && output == "mp4" {
            Some(("libx264", "mp4"))
        } else if operation == "audio-output" && category == "video" {
            // The output format decides the mode: a video container mutes the
            // clip, an audio container extracts its first audio stream.
            AUDIO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == output)
                .or_else(|| VIDEO_OUTPUTS.iter().find(|entry| entry.0 == output))
                .map(|entry| (entry.1, entry.2))
        } else if operation == "extract-audio" && category == "video" {
            AUDIO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == output)
                .map(|entry| (entry.1, entry.2))
        } else if category == "video" {
            VIDEO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == output)
                .map(|entry| (entry.1, entry.2))
        } else {
            AUDIO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == output)
                .map(|entry| (entry.1, entry.2))
        };
        let Some((encoder, muxer)) = output_spec else {
            return false;
        };
        if !has(&self.encoders, encoder) || !has(&self.muxers, muxer) {
            return false;
        }
        if operation == "visualize" && !has(&self.encoders, "aac") {
            return false;
        }
        if category == "video"
            && ![
                "snapshot",
                "extract-audio",
                "mute",
                "gif",
                "frames-gif",
                "audio-output",
            ]
            .contains(&operation)
        {
            let audio_encoder = video_audio_encoder(output);
            if !has(&self.encoders, audio_encoder) {
                return false;
            }
        }
        let filters = match operation {
            "convert" | "compress" | "trim" | "split" | "strip-metadata" | "extract-audio"
            | "mute" | "snapshot" | "audio-output" => &[][..],
            "merge" => &["concat", "setpts", "asetpts"][..],
            "resize" => &["scale"][..],
            "crop" => &["crop"][..],
            "crop-resize" => &["crop", "scale"][..],
            "flip" => &["hflip", "vflip"][..],
            "rotate" => &["hflip", "vflip", "transpose"][..],
            "rotate-flip" => &["hflip", "vflip", "transpose"][..],
            "speed" => &["setpts", "atempo"][..],
            "gif" => &["fps", "scale"][..],
            "frames-gif" => {
                if output == "gif" {
                    &["fps", "scale"][..]
                } else {
                    &[][..]
                }
            }
            "normalize" => &["loudnorm", "aresample"][..],
            "channels" => &["aresample"][..],
            "visualize" => &["showwaves", "color", "overlay", "format"][..],
            "redact" => &["drawbox", "overlay"][..],
            _ => return false,
        };
        filters.iter().all(|filter| has(&self.filters, filter))
    }

    pub fn capabilities(&self) -> Vec<Value> {
        let mut result = Vec::new();
        for category in ["video", "audio"] {
            let inputs = if category == "video" {
                VIDEO_INPUTS
            } else {
                AUDIO_INPUTS
            };
            let mut operations = vec![
                "convert",
                "compress",
                "trim",
                "split",
                "merge",
                "strip-metadata",
            ];
            if category == "video" {
                operations.extend([
                    "speed",
                    "redact",
                    "crop-resize",
                    "rotate-flip",
                    "frames-gif",
                    "audio-output",
                ]);
            } else {
                operations.extend(["normalize", "channels", "visualize"]);
            }
            for operation in operations {
                let outputs = if operation == "frames-gif" {
                    vec!["png", "gif"]
                } else if operation == "visualize" {
                    vec!["mp4"]
                } else if operation == "audio-output" {
                    VIDEO_OUTPUTS
                        .iter()
                        .map(|entry| entry.0)
                        .chain(AUDIO_OUTPUTS.iter().map(|entry| entry.0))
                        .collect()
                } else if operation == "extract-audio" || category == "audio" {
                    AUDIO_OUTPUTS.iter().map(|entry| entry.0).collect()
                } else {
                    VIDEO_OUTPUTS.iter().map(|entry| entry.0).collect()
                };
                let available_inputs = inputs
                    .iter()
                    .filter(|input| {
                        outputs
                            .iter()
                            .any(|output| self.supports(category, operation, input, output))
                    })
                    .copied()
                    .collect::<Vec<_>>();
                let available_outputs = outputs
                    .iter()
                    .filter(|output| {
                        available_inputs
                            .iter()
                            .any(|input| self.supports(category, operation, input, output))
                    })
                    .copied()
                    .collect::<Vec<_>>();
                let label = match operation {
                    "crop-resize" => "Crop & resize".to_string(),
                    "rotate-flip" => "Rotate & flip".to_string(),
                    "frames-gif" => "Frames & GIF".to_string(),
                    "audio-output" => "Mute & extract audio".to_string(),
                    _ => format!("{} {category}", operation.replace('-', " ")),
                };
                result.push(json!({ "id": format!("{category}:{operation}"), "operation": operation,
                    "label": label, "category": category,
                    "inputs": available_inputs, "outputs": available_outputs, "backend": "ffmpeg",
                    "available": !available_outputs.is_empty(), "batch": !["merge", "audio-output"].contains(&operation), "preservesMetadata": !["strip-metadata", "frames-gif", "audio-output"].contains(&operation),
                    "options": if operation == "split" { json!({ "segments": "0-5,8-12" }) } else if operation == "merge" { json!({ "reencode": [true, false] }) } else { json!({}) },
                    "warning": "" }));
            }
        }
        result
    }

    pub fn run(
        &self,
        input: &Path,
        output: &Path,
        category: &str,
        operation: &str,
        format: &str,
        options: &Value,
        cancelled: impl Fn() -> bool,
    ) -> Result<(), String> {
        let extension = input
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !self.supports(category, operation, &extension, format) {
            return Err("Media route is unavailable".into());
        }
        let ffprobe = self.ffprobe.as_ref().ok_or("FFprobe is unavailable")?;
        let mut inspect = Command::new(ffprobe);
        inspect
            .args([
                "-v",
                "error",
                "-protocol_whitelist",
                "file",
                "-show_entries",
                "format=format_name",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                "-i",
            ])
            .arg(input);
        let probe_output =
            captured(inspect, Duration::from_secs(10), &cancelled).map_err(safe_media_error)?;
        if !probe_output
            .split([',', '\n'])
            .any(|part| part.trim() == demuxer(&extension))
        {
            return Err("Media signature does not match its supported container".into());
        }
        let ffmpeg = self.ffmpeg.as_ref().ok_or("FFmpeg is unavailable")?;
        let mut command = Command::new(ffmpeg);
        command
            .args([
                "-hide_banner",
                "-nostdin",
                "-v",
                "error",
                "-n",
                "-protocol_whitelist",
                "file",
                "-f",
                demuxer(&extension),
                "-i",
            ])
            .arg(input);
        let numeric =
            |key: &str, default: f64, min: f64, max: f64| bounded(options, key, default, min, max);
        let redact_size = if operation == "redact" && category == "video" {
            Some(self.video_dimensions(input, &cancelled)?)
        } else {
            None
        };
        let mut redact_directory = None;
        let redact_graph = if let Some((width, height)) = redact_size {
            if redact_needs_overlay(options) {
                let directory =
                    std::env::temp_dir().join(format!("santra-redact-{}", Uuid::new_v4()));
                fs::create_dir_all(&directory)
                    .map_err(|_| "Cannot prepare redaction masks")?;
                let overlays = redact_overlays(options, width, height, &directory)?;
                if overlays.is_empty() {
                    return Err("Select 1–16 redaction masks".into());
                }
                for overlay in &overlays {
                    command.args(["-loop", "1", "-i"]).arg(&overlay.path);
                }
                let mut graph = String::new();
                let mut last = "[0:v]".to_string();
                for (index, overlay) in overlays.iter().enumerate() {
                    let label = if index + 1 == overlays.len() {
                        "[video]".to_string()
                    } else {
                        format!("[v{index}]")
                    };
                    graph.push_str(&format!(
                        "{last}[{}:v]overlay=x={}:y={}:shortest=1:enable='between(t,{},{})'{label};",
                        index + 1,
                        overlay.x,
                        overlay.y,
                        overlay.start,
                        overlay.end
                    ));
                    last = label;
                }
                redact_directory = Some(directory);
                Some(graph)
            } else {
                None
            }
        } else {
            None
        };
        if operation == "trim" || operation == "split" {
            command.args([
                "-ss",
                &numeric("start", 0.0, 0.0, 604_800.0)?.to_string(),
                "-t",
                &numeric("duration", 10.0, 0.01, 604_800.0)?.to_string(),
            ]);
        }
        if operation == "gif" || (operation == "frames-gif" && format == "gif") {
            command.args([
                "-ss",
                &numeric("start", 0.0, 0.0, 604_800.0)?.to_string(),
                "-t",
                &numeric("duration", 10.0, 0.01, 604_800.0)?.to_string(),
            ]);
        }
        if operation == "snapshot" || (operation == "frames-gif" && format == "png") {
            command.args([
                "-ss",
                &numeric("time", 0.0, 0.0, 604_800.0)?.to_string(),
                "-map",
                "0:v:0",
                "-frames:v",
                "1",
                "-an",
                "-sn",
                "-dn",
                "-c:v",
                "png",
            ]);
        } else if operation == "gif" || (operation == "frames-gif" && format == "gif") {
            let fps = numeric("fps", 12.0, 1.0, 60.0)?;
            let width = numeric("width", 480.0, 2.0, 2048.0)?;
            if fps.fract() != 0.0 || width.fract() != 0.0 {
                return Err("Invalid GIF dimensions or frame rate".into());
            }
            command.args([
                "-map",
                "0:v:0",
                "-an",
                "-sn",
                "-dn",
                "-c:v",
                "gif",
                "-vf",
                &format!("fps={fps},scale={width}:-1"),
            ]);
        } else if operation == "visualize" {
            let width = numeric("width", 1280.0, 2.0, 4096.0)?;
            let height = numeric("height", 720.0, 2.0, 4096.0)?;
            let fps = numeric("fps", 30.0, 1.0, 60.0)?;
            if [width, height, fps]
                .iter()
                .any(|value| value.fract() != 0.0)
                || (width as u64) * (height as u64) > 8_294_400
                || (width as u32) % 2 != 0
                || (height as u32) % 2 != 0
            {
                return Err("Invalid waveform dimensions or frame rate".into());
            }
            let style = options
                .get("style")
                .and_then(Value::as_str)
                .unwrap_or("line");
            if !["point", "line", "p2p", "cline"].contains(&style) {
                return Err("Invalid waveform style".into());
            }
            let background = color(options, "backgroundColor", "#111827")?;
            let wave = color(options, "waveColor", "#ff5a00")?;
            let graph = format!("color=c={background}:s={width}x{height}:r={fps}[background];[0:a:0]showwaves=s={width}x{height}:r={fps}:mode={style}:colors={wave}:draw=full,format=rgba[wave];[background][wave]overlay=shortest=1:format=auto,format=yuv420p[video]");
            let quality = numeric("quality", 75.0, 1.0, 100.0)?;
            command.args([
                "-filter_complex",
                &graph,
                "-map",
                "[video]",
                "-map",
                "0:a:0",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-crf",
                &((51.0 - quality * 0.5).round() as u32).to_string(),
                "-c:a",
                "aac",
                "-shortest",
            ]);
        } else if category == "audio"
            || operation == "extract-audio"
            || (operation == "audio-output"
                && AUDIO_OUTPUTS.iter().any(|entry| entry.0 == format))
        {
            let encoder = AUDIO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == format)
                .ok_or("Invalid audio format")?
                .1;
            command.args(["-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", encoder]);
            if operation == "normalize" {
                let loudness = numeric("loudness", -16.0, -70.0, -5.0)?;
                let peak = numeric("truePeak", -1.5, -9.0, 0.0)?;
                let range = numeric("loudnessRange", 11.0, 1.0, 50.0)?;
                command.args([
                    "-af",
                    &format!("loudnorm=I={loudness}:TP={peak}:LRA={range},aresample=48000"),
                ]);
            } else if operation == "channels" {
                let channels = numeric("channels", 1.0, 1.0, 2.0)?;
                if channels.fract() != 0.0 {
                    return Err("Invalid channel count".into());
                }
                command.args(["-ac", &channels.to_string()]);
            }
        } else {
            let encoder = VIDEO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == format)
                .ok_or("Invalid video format")?
                .1;
            if redact_graph.is_none() {
                command.args(["-map", "0:v:0", "-c:v", encoder, "-sn", "-dn"]);
                if operation == "mute" || operation == "audio-output" {
                    command.arg("-an");
                } else {
                    command.args(["-map", "0:a:0?", "-c:a", video_audio_encoder(format)]);
                }
            }
            let filter = match operation {
                "resize" => Some(format!(
                    "scale={}:{}",
                    numeric("width", 1280.0, 2.0, 16_384.0)? as u32,
                    numeric("height", 720.0, 2.0, 16_384.0)? as u32
                )),
                "crop" => Some(format!(
                    "crop={}:{}:{}:{}",
                    numeric("width", 1280.0, 2.0, 16_384.0)? as u32,
                    numeric("height", 720.0, 2.0, 16_384.0)? as u32,
                    numeric("x", 0.0, 0.0, 16_384.0)? as u32,
                    numeric("y", 0.0, 0.0, 16_384.0)? as u32
                )),
                "crop-resize" => {
                    let x = numeric("cropX", 0.0, 0.0, 16_384.0)? as u32;
                    let y = numeric("cropY", 0.0, 0.0, 16_384.0)? as u32;
                    let crop_width = numeric("cropWidth", 0.0, 0.0, 16_384.0)? as u32;
                    let crop_height = numeric("cropHeight", 0.0, 0.0, 16_384.0)? as u32;
                    let mut filters = Vec::new();
                    if crop_width >= 2 && crop_height >= 2 {
                        filters.push(format!("crop={crop_width}:{crop_height}:{x}:{y}"));
                    }
                    if options.get("width").is_some() || options.get("height").is_some() {
                        filters.push(format!(
                            "scale={}:{}",
                            numeric("width", 1280.0, 2.0, 16_384.0)? as u32,
                            numeric("height", 720.0, 2.0, 16_384.0)? as u32
                        ));
                    }
                    (!filters.is_empty()).then(|| filters.join(","))
                }
                "rotate" => Some(match numeric("angle", 90.0, 90.0, 270.0)? as u32 {
                    90 => "transpose=1".into(),
                    180 => "hflip,vflip".into(),
                    270 => "transpose=2".into(),
                    _ => return Err("Invalid rotation angle".into()),
                }),
                "rotate-flip" => {
                    let angle = numeric("angle", 0.0, 0.0, 270.0)? as u32;
                    let direction = options
                        .get("direction")
                        .and_then(Value::as_str)
                        .unwrap_or("none");
                    if ![0, 90, 180, 270].contains(&angle) {
                        return Err("Invalid rotation angle".into());
                    }
                    if !["none", "horizontal", "vertical"].contains(&direction) {
                        return Err("Invalid flip direction".into());
                    }
                    let mut filters = Vec::new();
                    match angle {
                        90 => filters.push("transpose=1".to_string()),
                        180 => {
                            filters.push("hflip".to_string());
                            filters.push("vflip".to_string());
                        }
                        270 => filters.push("transpose=2".to_string()),
                        _ => {}
                    }
                    match direction {
                        "horizontal" => filters.push("hflip".to_string()),
                        "vertical" => filters.push("vflip".to_string()),
                        _ => {}
                    }
                    (!filters.is_empty()).then(|| filters.join(","))
                }
                "flip" => Some(
                    match options
                        .get("direction")
                        .and_then(Value::as_str)
                        .unwrap_or("horizontal")
                    {
                        "horizontal" => "hflip".into(),
                        "vertical" => "vflip".into(),
                        _ => return Err("Invalid flip direction".into()),
                    },
                ),
                "speed" => {
                    let factor = numeric("factor", 1.0, 0.25, 4.0)?;
                    let audio = if factor < 0.5 {
                        format!("atempo=0.5,atempo={}", factor / 0.5)
                    } else if factor > 2.0 {
                        format!("atempo=2,atempo={}", factor / 2.0)
                    } else {
                        format!("atempo={factor}")
                    };
                    command.args(["-af", &audio]);
                    Some(format!("setpts=(PTS-STARTPTS)/{factor}"))
                }
                "redact" => {
                    let (width, height) = redact_size.ok_or("Cannot inspect video dimensions for redaction")?;
                    if redact_graph.is_some() {
                        None
                    } else {
                        Some(redact_filter(options, width, height)?)
                    }
                }
                _ => None,
            };
            if let Some(graph) = &redact_graph {
                command.args(["-filter_complex", graph.as_str(), "-map", "[video]", "-sn", "-dn"]);
                if operation == "mute" || operation == "audio-output" {
                    command.arg("-an");
                } else {
                    command.args(["-map", "0:a:0?", "-c:a", video_audio_encoder(format)]);
                }
            } else {
                if let Some(filter) = filter {
                    command.args(["-vf", &filter]);
                }
            }
            let quality = numeric("quality", 75.0, 1.0, 100.0)?;
            if encoder == "libx264" {
                command.args([
                    "-pix_fmt",
                    "yuv420p",
                    "-crf",
                    &((51.0 - quality * 0.5).round() as u32).to_string(),
                ]);
            }
        }
        let strip = operation == "strip-metadata"
            || options
                .get("stripMetadata")
                .and_then(Value::as_bool)
                .unwrap_or(false);
        if strip {
            command.args([
                "-map_metadata",
                "-1",
                "-map_metadata:s",
                "-1",
                "-map_chapters",
                "-1",
            ]);
        } else {
            command.args(["-map_metadata", "0", "-map_chapters", "0"]);
        }
        let muxer = if operation == "snapshot" || (operation == "frames-gif" && format == "png") {
            "image2pipe"
        } else if operation == "gif" || (operation == "frames-gif" && format == "gif") {
            "gif"
        } else if operation == "visualize" {
            "mp4"
        } else if category == "audio"
            || operation == "extract-audio"
            || (operation == "audio-output"
                && AUDIO_OUTPUTS.iter().any(|entry| entry.0 == format))
        {
            AUDIO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == format)
                .ok_or("Invalid output")?
                .2
        } else {
            VIDEO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == format)
                .ok_or("Invalid output")?
                .2
        };
        command.args(["-f", muxer]).arg(output);
        let result =
            captured(command, Duration::from_secs(3600), cancelled).map_err(safe_media_error);
        if let Some(directory) = &redact_directory {
            let _ = fs::remove_dir_all(directory);
        }
        result?;
        Ok(())
    }

    fn merge_streams(
        &self,
        input: &Path,
        cancelled: &impl Fn() -> bool,
    ) -> Result<(Value, Option<Value>), String> {
        let extension = input
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let ffprobe = self.ffprobe.as_ref().ok_or("FFprobe is unavailable")?;
        let mut command = Command::new(ffprobe);
        command.args(["-v", "error", "-protocol_whitelist", "file", "-show_data_hash", "sha256", "-show_entries",
            "format=format_name:stream=codec_type,codec_name,width,height,pix_fmt,sample_rate,channels,channel_layout,time_base,extradata_hash",
            "-of", "json", "-i"]).arg(input);
        let output =
            captured(command, Duration::from_secs(15), cancelled).map_err(safe_media_error)?;
        let value: Value =
            serde_json::from_str(&output).map_err(|_| "Cannot inspect media streams")?;
        let names = value["format"]["format_name"]
            .as_str()
            .ok_or("Cannot inspect media container")?;
        if !names.split(',').any(|name| name == demuxer(&extension)) {
            return Err("Media signature does not match its container".into());
        }
        let streams = value["streams"]
            .as_array()
            .ok_or("Cannot inspect media streams")?;
        let video = streams
            .iter()
            .find(|stream| stream["codec_type"] == "video")
            .cloned();
        let audio = streams
            .iter()
            .find(|stream| stream["codec_type"] == "audio")
            .cloned();
        Ok((video.unwrap_or(Value::Null), audio))
    }

    pub fn run_merge(
        &self,
        inputs: &[PathBuf],
        output: &Path,
        category: &str,
        format: &str,
        options: &Value,
        cancelled: impl Fn() -> bool,
    ) -> Result<(), String> {
        if !(2..=16).contains(&inputs.len()) {
            return Err("Select 2–16 media files to merge".into());
        }
        let reencode = match options.get("reencode") {
            None => true,
            Some(Value::Bool(value)) => *value,
            Some(Value::String(value)) if value == "true" => true,
            Some(Value::String(value)) if value == "false" => false,
            _ => return Err("Invalid merge encoding choice".into()),
        };
        let first_extension = inputs[0]
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !self.supports(category, "merge", &first_extension, format) {
            return Err("Media merge route is unavailable".into());
        }
        let mut first_video = Value::Null;
        let mut first_audio = None;
        for (index, input) in inputs.iter().enumerate() {
            let extension = input
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !self.supports(category, "merge", &extension, format) {
                return Err("A selected media input is unsupported".into());
            }
            let metadata = fs::symlink_metadata(input).map_err(|_| "Media input is unavailable")?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("Merge inputs must be regular files".into());
            }
            let (video, audio) = self.merge_streams(input, &cancelled)?;
            if (category == "video" && video.is_null()) || audio.is_none() && category == "audio" {
                return Err("Required media stream is missing".into());
            }
            if index == 0 {
                first_video = video;
                first_audio = audio;
            } else {
                if category == "video"
                    && (video["width"] != first_video["width"]
                        || video["height"] != first_video["height"]
                        || audio.is_some() != first_audio.is_some())
                {
                    return Err(
                        "Video dimensions or audio tracks differ; preprocess clips before merging"
                            .into(),
                    );
                }
                if !reencode && (video != first_video || audio != first_audio) {
                    return Err("Direct-copy merge requires matching stream configuration".into());
                }
            }
            if !reencode && extension != first_extension {
                return Err("Direct-copy merge requires matching containers".into());
            }
        }
        if !reencode && format != first_extension {
            return Err("Direct-copy merge requires the original container".into());
        }
        let ffmpeg = self.ffmpeg.as_ref().ok_or("FFmpeg is unavailable")?;
        let mut command = Command::new(ffmpeg);
        command.args(["-hide_banner", "-nostdin", "-v", "error", "-n"]);
        let manifest = output.with_extension("ffconcat");
        if reencode {
            for input in inputs {
                let extension = input
                    .extension()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                command
                    .args([
                        "-protocol_whitelist",
                        "file",
                        "-f",
                        demuxer(&extension),
                        "-i",
                    ])
                    .arg(input);
            }
            let video = category == "video";
            let audio = category == "audio" || first_audio.is_some();
            let mut graph = String::new();
            let mut labels = String::new();
            for index in 0..inputs.len() {
                if video {
                    graph.push_str(&format!("[{index}:v:0]setpts=PTS-STARTPTS[v{index}];"));
                    labels.push_str(&format!("[v{index}]"));
                }
                if audio {
                    graph.push_str(&format!("[{index}:a:0]asetpts=PTS-STARTPTS[a{index}];"));
                    labels.push_str(&format!("[a{index}]"));
                }
            }
            graph.push_str(&format!(
                "{labels}concat=n={}:v={}:a={}{}",
                inputs.len(),
                u8::from(video),
                u8::from(audio),
                if video && audio {
                    "[v][a]"
                } else if video {
                    "[v]"
                } else {
                    "[a]"
                }
            ));
            command.args(["-filter_complex", &graph]);
            if video {
                let encoder = VIDEO_OUTPUTS
                    .iter()
                    .find(|entry| entry.0 == format)
                    .ok_or("Invalid video merge output")?
                    .1;
                command.args(["-map", "[v]", "-c:v", encoder]);
                if encoder == "libx264" {
                    let quality = bounded(options, "quality", 75.0, 1.0, 100.0)?;
                    command.args([
                        "-pix_fmt",
                        "yuv420p",
                        "-crf",
                        &((51.0 - quality * 0.5).round() as u32).to_string(),
                    ]);
                }
            }
            if audio {
                let encoder = if video {
                    video_audio_encoder(format)
                } else {
                    AUDIO_OUTPUTS
                        .iter()
                        .find(|entry| entry.0 == format)
                        .ok_or("Invalid audio merge output")?
                        .1
                };
                command.args(["-map", "[a]", "-c:a", encoder]);
            }
        } else {
            let mut contents = String::from("ffconcat version 1.0\n");
            for input in inputs {
                let text = input
                    .to_str()
                    .ok_or("Invalid media path encoding")?
                    .replace('\\', "/");
                if text.chars().any(char::is_control) {
                    return Err("Invalid media path".into());
                }
                contents.push_str(&format!("file '{}'\n", text.replace('\'', "'\\''")));
            }
            let mut open = OpenOptions::new();
            open.write(true).create_new(true);
            #[cfg(unix)]
            open.mode(0o600);
            let mut file = open.open(&manifest).map_err(|error| error.to_string())?;
            let write_result = file
                .write_all(contents.as_bytes())
                .and_then(|_| file.sync_all());
            drop(file);
            if let Err(error) = write_result {
                let _ = fs::remove_file(&manifest);
                return Err(error.to_string());
            }
            command
                .args([
                    "-protocol_whitelist",
                    "file",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                ])
                .arg(&manifest);
            if category == "video" {
                command.args(["-map", "0:v:0"]);
            }
            if category == "audio" || first_audio.is_some() {
                command.args(["-map", "0:a:0"]);
            }
            command.args(["-c", "copy", "-sn", "-dn"]);
        }
        if options
            .get("stripMetadata")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            command.args(["-map_metadata", "-1", "-map_chapters", "-1"]);
        } else {
            command.args(["-map_metadata", "0", "-map_chapters", "0"]);
        }
        let muxer = if category == "video" {
            VIDEO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == format)
                .ok_or("Invalid video merge output")?
                .2
        } else {
            AUDIO_OUTPUTS
                .iter()
                .find(|entry| entry.0 == format)
                .ok_or("Invalid audio merge output")?
                .2
        };
        command.args(["-f", muxer]).arg(output);
        let result = captured(command, Duration::from_secs(3600), cancelled)
            .map_err(safe_media_error)
            .map(|_| ());
        if !reencode {
            let _ = fs::remove_file(manifest);
        }
        result
    }
}

fn video_audio_encoder(format: &str) -> &'static str {
    match format {
        "webm" => "libopus",
        "avi" => "libmp3lame",
        "wmv" => "wmav2",
        _ => "aac",
    }
}

fn safe_media_error(error: String) -> String {
    if error == "Cancelled" || error == "Local media backend timed out" {
        error
    } else {
        "Local media backend failed; check the input, format, and installed codecs".into()
    }
}

fn demuxer(extension: &str) -> &'static str {
    match extension {
        "mp4" | "mov" | "m4a" => "mov",
        "mkv" | "webm" => "matroska",
        "avi" => "avi",
        "wmv" | "wma" => "asf",
        "mp3" => "mp3",
        "wav" => "wav",
        "flac" => "flac",
        "ogg" | "opus" => "ogg",
        "aiff" => "aiff",
        _ => "unknown",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_local_wav_when_ffmpeg_codec_is_available() {
        let backend = detect(&Default::default());
        if !backend.supports("audio", "convert", "wav", "mp3") {
            return;
        }
        let directory =
            std::env::temp_dir().join(format!("santra-media-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let input = directory.join("tone.wav");
        let output = directory.join("out.tmp");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36_u32 + 16_000).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&16_000_u32.to_le_bytes());
        bytes.extend_from_slice(&32_000_u32.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&16_000_u32.to_le_bytes());
        bytes.resize(bytes.len() + 16_000, 0);
        std::fs::write(&input, bytes).unwrap();
        let details = backend.preview_details(&input).unwrap();
        assert!(details["duration"]
            .as_f64()
            .is_some_and(|duration| duration > 0.4));
        backend
            .run(
                &input,
                &output,
                "audio",
                "convert",
                "mp3",
                &json!({}),
                || false,
            )
            .unwrap();
        assert!(std::fs::metadata(&output).unwrap().len() > 100);
        if backend.supports("audio", "split", "wav", "mp3") {
            let clip = directory.join("clip.tmp");
            backend
                .run(
                    &input,
                    &clip,
                    "audio",
                    "split",
                    "mp3",
                    &json!({"start": 0, "duration": 0.25}),
                    || false,
                )
                .unwrap();
            assert!(std::fs::metadata(&clip).unwrap().len() > 100);
        }
        if backend.supports("audio", "merge", "wav", "mp3") {
            let joined = directory.join("joined.tmp");
            backend
                .run_merge(
                    &[input.clone(), input.clone()],
                    &joined,
                    "audio",
                    "mp3",
                    &json!({"reencode": true}),
                    || false,
                )
                .unwrap();
            assert!(joined.metadata().unwrap().len() > 100);
        }
        if backend.supports("audio", "merge", "wav", "wav") {
            let copied = directory.join("copied.tmp");
            backend
                .run_merge(
                    &[input.clone(), input.clone()],
                    &copied,
                    "audio",
                    "wav",
                    &json!({"reencode": false}),
                    || false,
                )
                .unwrap();
            assert!(copied.metadata().unwrap().len() > input.metadata().unwrap().len());
        }
        if backend.supports("audio", "visualize", "wav", "mp4") {
            let video = directory.join("wave.tmp");
            backend
                .run(
                    &input,
                    &video,
                    "audio",
                    "visualize",
                    "mp4",
                    &json!({"width": 64, "height": 64, "fps": 2}),
                    || false,
                )
                .unwrap();
            assert!(std::fs::metadata(&video).unwrap().len() > 100);
        }
        if has(&backend.filters, "showwavespic") && has(&backend.encoders, "png") {
            let waveform = directory.join("waveform.png");
            backend.waveform(&input, &waveform, || false).unwrap();
            assert!(std::fs::read(&waveform)
                .unwrap()
                .starts_with(b"\x89PNG\r\n\x1a\n"));
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn exports_local_video_frame_and_gif_when_available() {
        let backend = detect(&Default::default());
        if !backend.supports("video", "snapshot", "mp4", "png")
            || !backend.supports("video", "gif", "mp4", "gif")
        {
            return;
        }
        let directory =
            std::env::temp_dir().join(format!("santra-video-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let input = directory.join("input.mp4");
        let status = Command::new(backend.ffmpeg.as_ref().unwrap())
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=64x64:d=1:r=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-y",
            ])
            .arg(&input)
            .status()
            .unwrap();
        if !status.success() {
            std::fs::remove_dir_all(directory).unwrap();
            return;
        }
        assert_eq!(backend.preview_details(&input).unwrap()["width"], 64);
        if backend.supports("video", "convert", "mp4", "mp4") {
            let preview = directory.join("preview.mp4");
            backend.preview_video(&input, &preview).unwrap();
            assert!(preview.metadata().unwrap().len() > 100);
        }
        let frame = directory.join("frame.tmp");
        backend
            .run(
                &input,
                &frame,
                "video",
                "snapshot",
                "png",
                &json!({"time": 0.5}),
                || false,
            )
            .unwrap();
        assert!(frame.metadata().unwrap().len() > 100);
        let gif = directory.join("out.tmp");
        backend
            .run(
                &input,
                &gif,
                "video",
                "gif",
                "gif",
                &json!({"fps": 2, "width": 64}),
                || false,
            )
            .unwrap();
        assert!(gif.metadata().unwrap().len() > 100);
        if backend.supports("video", "redact", "mp4", "mp4") {
            let redacted = directory.join("redacted.tmp");
            backend.run(&input, &redacted, "video", "redact", "mp4", &json!({"masks": [{"x": 0, "y": 0, "width": 16, "height": 16, "start": 0, "end": 1, "color": "#000000"}]}), || false).unwrap();
            assert!(redacted.metadata().unwrap().len() > 100);
            assert!(redact_filter(
                &json!({"masks": [{"x": 60, "y": 0, "width": 16, "height": 16}]}),
                64,
                64
            )
            .is_err());
        }
        if backend.supports("video", "merge", "mp4", "mp4") {
            let joined = directory.join("joined-video.tmp");
            backend
                .run_merge(
                    &[input.clone(), input.clone()],
                    &joined,
                    "video",
                    "mp4",
                    &json!({"reencode": true}),
                    || false,
                )
                .unwrap();
            assert!(joined.metadata().unwrap().len() > input.metadata().unwrap().len());
        }
        std::fs::remove_dir_all(directory).unwrap();
    }
}
