#![cfg(windows)]

use serde::Deserialize;
use std::{
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::{AppHandle, Manager};

use crate::services::{AppState, Shortcuts};

static WATCHER: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn process_slot() -> &'static Mutex<Option<Child>> {
    WATCHER.get_or_init(|| Mutex::new(None))
}

#[derive(Deserialize)]
struct Event {
    #[serde(rename = "type")]
    kind: String,
    mode: String,
    x: i32,
    y: i32,
}

fn helper_path(app: &AppHandle) -> Option<PathBuf> {
    let packaged = app
        .path()
        .resource_dir()
        .ok()?
        .join("native")
        .join("santra-drag-watcher.exe");
    if packaged.is_file() {
        return Some(packaged);
    }
    if cfg!(debug_assertions) {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("native")
            .join("windows")
            .join("build")
            .join("santra-drag-watcher.exe");
        if development.is_file() {
            return Some(development);
        }
    }
    None
}

fn mode_for(shortcuts: &Shortcuts, key: &str) -> &'static str {
    for (mode, configured) in [
        ("convert", &shortcuts.convert),
        ("tools", &shortcuts.tools),
        ("actions", &shortcuts.actions),
    ] {
        if configured == key || (key == "Control" && configured == "Ctrl") {
            return mode;
        }
    }
    "none"
}

pub fn start(app: &AppHandle) {
    let Some(path) = helper_path(app) else {
        eprintln!("Optional Windows drag watcher is not installed");
        return;
    };
    if fs::symlink_metadata(&path).map_or(true, |metadata| {
        !metadata.is_file() || metadata.file_type().is_symlink()
    }) {
        eprintln!("Optional Windows drag watcher path is not a regular file");
        return;
    }
    let Ok(shortcuts) = app.state::<AppState>().shortcuts() else {
        return;
    };
    let mut command = Command::new(path);
    command
        .args([
            "--shift-mode",
            mode_for(&shortcuts, "Shift"),
            "--alt-mode",
            mode_for(&shortcuts, "Alt"),
            "--control-mode",
            mode_for(&shortcuts, "Control"),
            "--ctrl-shift-mode",
            mode_for(&shortcuts, "Ctrl+Shift"),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
    let Ok(mut child) = command.spawn() else {
        eprintln!("Optional Windows drag watcher could not start");
        return;
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return;
    };
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(mut slot) = process_slot().lock() {
        *slot = Some(child);
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if GENERATION.load(Ordering::SeqCst) != generation {
                break;
            }
            let Ok(line) = line else { break };
            if line.len() > 512 {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Event>(&line) else {
                continue;
            };
            match event.kind.as_str() {
                "show" if ["convert", "tools", "actions"].contains(&event.mode.as_str()) => {
                    super::show_wheel(&handle, &event.mode, Some((event.x, event.y)))
                }
                "hide" => super::hide_wheel(&handle),
                "move" => {}
                _ => {}
            }
        }
    });
}

pub fn stop(_app: &AppHandle) {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Ok(mut slot) = process_slot().lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn restart(app: &AppHandle) {
    stop(app);
    start(app);
}
