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
        filters.push(format!(
            "drawbox=x={x}:y={y}:w={w}:h={h}:color={fill}:t=fill:enable='between(t,{start},{end})'"
        ));
    }
    Ok(filters.join(","))
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
        let output_spec = if operation == "snapshot" && category == "video" && output == "png" {
            Some(("png", "image2pipe"))
        } else if operation == "gif" && category == "video" && output == "gif" {
            Some(("gif", "gif"))
        } else if operation == "visualize" && category == "audio" && output == "mp4" {
            Some(("libx264", "mp4"))
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
        if category == "video" && !["snapshot", "extract-audio", "mute", "gif"].contains(&operation)
        {
            let audio_encoder = video_audio_encoder(output);
            if !has(&self.encoders, audio_encoder) {
                return false;
            }
        }
        let filters = match operation {
            "convert" | "compress" | "trim" | "split" | "strip-metadata" | "extract-audio"
            | "mute" | "snapshot" => &[][..],
            "merge" => &["concat", "setpts", "asetpts"][..],
            "resize" => &["scale"][..],
            "crop" => &["crop"][..],
            "flip" => &["hflip", "vflip"][..],
            "rotate" => &["hflip", "vflip", "transpose"][..],
            "speed" => &["setpts", "atempo"][..],
            "gif" => &["fps", "scale"][..],
            "normalize" => &["loudnorm", "aresample"][..],
            "channels" => &["aresample"][..],
            "visualize" => &["showwaves", "color", "overlay", "format"][..],
            "redact" => &["drawbox"][..],
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
                    "resize",
                    "crop",
                    "rotate",
                    "flip",
                    "mute",
                    "speed",
                    "snapshot",
                    "extract-audio",
                    "gif",
                    "redact",
                ]);
            } else {
                operations.extend(["normalize", "channels", "visualize"]);
            }
            for operation in operations {
                let outputs = if operation == "snapshot" {
                    vec!["png"]
                } else if operation == "gif" {
                    vec!["gif"]
                } else if operation == "visualize" {
                    vec!["mp4"]
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
                result.push(json!({ "id": format!("{category}:{operation}"), "operation": operation,
                    "label": format!("{} {category}", operation.replace('-', " ")), "category": category,
                    "inputs": available_inputs, "outputs": available_outputs, "backend": "ffmpeg",
                    "available": !available_outputs.is_empty(), "batch": operation != "merge", "preservesMetadata": !["strip-metadata", "snapshot", "gif"].contains(&operation),
                    "options": if operation == "split" { json!({ "segments": "0-5,8-12" }) } else if operation == "merge" { json!({ "reencode": [true, false] }) } else { json!({}) },
                    "warning": "Uses the first media streams. Codec and container metadata support varies; compression can increase size." }));
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
        if operation == "trim" || operation == "split" {
            command.args([
                "-ss",
                &numeric("start", 0.0, 0.0, 604_800.0)?.to_string(),
                "-t",
                &numeric("duration", 10.0, 0.01, 604_800.0)?.to_string(),
            ]);
        }
        if operation == "snapshot" {
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
        } else if operation == "gif" {
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
        } else if category == "audio" || operation == "extract-audio" {
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
            command.args(["-map", "0:v:0", "-c:v", encoder, "-sn", "-dn"]);
            if operation == "mute" {
                command.arg("-an");
            } else {
                command.args(["-map", "0:a:0?", "-c:a", video_audio_encoder(format)]);
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
                "rotate" => Some(match numeric("angle", 90.0, 90.0, 270.0)? as u32 {
                    90 => "transpose=1".into(),
                    180 => "hflip,vflip".into(),
                    270 => "transpose=2".into(),
                    _ => return Err("Invalid rotation angle".into()),
                }),
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
                    let mut dimensions = Command::new(ffprobe);
                    dimensions
                        .args([
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
                    let output = captured(dimensions, Duration::from_secs(10), &cancelled)
                        .map_err(safe_media_error)?;
                    let parts = output.trim().split(',').collect::<Vec<_>>();
                    if parts.len() != 2 {
                        return Err("Cannot inspect video dimensions for redaction".into());
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
                    Some(redact_filter(options, width, height)?)
                }
                _ => None,
            };
            if let Some(filter) = filter {
                command.args(["-vf", &filter]);
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
        let muxer = if operation == "snapshot" {
            "image2pipe"
        } else if operation == "gif" {
            "gif"
        } else if operation == "visualize" {
            "mp4"
        } else if category == "audio" || operation == "extract-audio" {
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
        captured(command, Duration::from_secs(3600), cancelled).map_err(safe_media_error)?;
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
