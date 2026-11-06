#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
compile_error!("Santra supports only Linux and Windows desktop targets");

mod archives;
mod documents;
mod media;
mod pdf;
mod processing;
mod services;
mod subtitles;
#[cfg(windows)]
mod windows_watcher;

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    DragDropEvent, Emitter, Manager, PhysicalPosition, WebviewWindow, WindowEvent,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    runtime: &'static str,
    platform: &'static str,
    shell_only: bool,
}

static WHEEL_VISIBILITY_GENERATION: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        runtime: "tauri",
        platform: if cfg!(windows) { "win32" } else { "linux" },
        shell_only: false,
    }
}

#[tauri::command]
fn shell_hide_wheel(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "wheel" {
        return Err("Only the wheel can close itself".into());
    }
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn shell_wheel_mode(state: tauri::State<'_, services::AppState>) -> Result<String, String> {
    state
        .wheel_mode
        .lock()
        .map(|mode| mode.clone())
        .map_err(|_| "Wheel state is unavailable".into())
}

static WHEEL_DRAG_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static WORKSPACE_DRAG_GENERATION: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
fn native_drag_generation(label: &str) -> &'static std::sync::atomic::AtomicU64 {
    if label == "wheel" {
        &WHEEL_DRAG_GENERATION
    } else {
        &WORKSPACE_DRAG_GENERATION
    }
}

fn centered_wheel_origin(
    point: (i32, i32),
    size: (u32, u32),
    area: (i32, i32, u32, u32),
) -> (i32, i32) {
    let clamp = |cursor: i32, length: u32, start: i32, available: u32| {
        let start = i64::from(start);
        let end = (start + i64::from(available) - i64::from(length)).max(start);
        (i64::from(cursor) - i64::from(length) / 2).clamp(start, end) as i32
    };
    (
        clamp(point.0, size.0, area.0, area.2),
        clamp(point.1, size.1, area.1, area.3),
    )
}

fn place_wheel(window: &WebviewWindow, requested: Option<(i32, i32)>) -> Result<(), String> {
    let cursor = window.cursor_position().ok();
    let point =
        requested.or_else(|| cursor.map(|value| (value.x.round() as i32, value.y.round() as i32)));
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let monitor = point
        .and_then(|(x, y)| {
            monitors
                .iter()
                .find(|monitor| {
                    let area = monitor.work_area();
                    x >= area.position.x
                        && y >= area.position.y
                        && i64::from(x) < i64::from(area.position.x) + i64::from(area.size.width)
                        && i64::from(y) < i64::from(area.position.y) + i64::from(area.size.height)
                })
                .cloned()
        })
        .or(window
            .current_monitor()
            .map_err(|error| error.to_string())?)
        .or(window
            .primary_monitor()
            .map_err(|error| error.to_string())?)
        .ok_or("No monitor is available for the wheel")?;
    let area = monitor.work_area();
    let point = point.unwrap_or((
        area.position.x + area.size.width as i32 / 2,
        area.position.y + area.size.height as i32 / 2,
    ));
    // Hidden GTK windows can report a zero size on cold startup. Use the configured
    // logical size and target monitor's scale instead of positioning that zero rect.
    let config = window
        .app_handle()
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
        .ok_or("Wheel window configuration is unavailable")?;
    let scale = monitor.scale_factor();
    let size = tauri::PhysicalSize::new(
        ((config.width * scale).round() as u32)
            .min(area.size.width)
            .max(1),
        ((config.height * scale).round() as u32)
            .min(area.size.height)
            .max(1),
    );
    let (x, y) = centered_wheel_origin(
        point,
        (size.width, size.height),
        (
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
        ),
    );
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    // Apply the physical size after moving to the target monitor, so its DPI
    // transition cannot scale a size chosen on the previous monitor a second time.
    if window.inner_size().ok() != Some(size) {
        window.set_size(size).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Debug, PartialEq)]
struct WheelRequest {
    action: &'static str,
    mode: Option<&'static str>,
    point: Option<(i32, i32)>,
}

fn wheel_request(args: &[String]) -> Option<WheelRequest> {
    let argument = |key: &str| args.iter().find_map(|value| value.strip_prefix(key));
    let action = match argument("--santra-wheel-action=")? {
        "show" => "show",
        "hide" => "hide",
        _ => return None,
    };
    let mode = match argument("--santra-global-wheel=") {
        Some("convert") => Some("convert"),
        Some("tools") => Some("tools"),
        Some("actions") => Some("actions"),
        Some("") | None if action == "hide" => None,
        _ => return None,
    };
    let point = match (argument("--santra-wheel-x="), argument("--santra-wheel-y=")) {
        (Some(x), Some(y)) => {
            let x = x.parse::<i32>().ok()?;
            let y = y.parse::<i32>().ok()?;
            Some((x, y))
        }
        (None, None) => None,
        _ => return None,
    };
    Some(WheelRequest {
        action,
        mode,
        point,
    })
}

fn show_wheel(app: &tauri::AppHandle, mode: &str, point: Option<(i32, i32)>) {
    let Some(window) = app.get_webview_window("wheel") else {
        return;
    };
    if ["convert", "tools", "actions"].contains(&mode) {
        WHEEL_VISIBILITY_GENERATION.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut current) = app.state::<services::AppState>().wheel_mode.lock() {
            *current = mode.into();
        }
        let new_drag = !window.is_visible().unwrap_or(false);
        if let Err(error) = place_wheel(&window, point) {
            eprintln!("Wheel placement unavailable: {error}");
        }
        let _ = window.emit(
            "santra:wheel-mode",
            serde_json::json!({ "mode": mode, "newDrag": new_drag }),
        );
        let _ = window.show();
    }
}

fn hide_wheel(app: &tauri::AppHandle) {
    let generation = WHEEL_VISIBILITY_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    std::thread::spawn(move || {
        // Give the native drop event time to reach the wheel after the mouse button is released.
        std::thread::sleep(std::time::Duration::from_millis(600));
        if WHEEL_VISIBILITY_GENERATION.load(Ordering::SeqCst) == generation {
            if let Some(window) = handle.get_webview_window("wheel") {
                let _ = window.hide();
            }
        }
    });
}

fn handle_wheel_request(app: &tauri::AppHandle, args: &[String]) -> bool {
    let Some(request) = wheel_request(args) else {
        return false;
    };
    if request.action == "hide" {
        hide_wheel(app);
    } else if let Some(mode) = request.mode {
        show_wheel(app, mode, request.point);
    }
    true
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !handle_wheel_request(app, &args) {
                if let Some(window) = app.get_webview_window("workspace") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }))
        .register_uri_scheme_protocol("santra-media", |context, request| {
            let state = context.app_handle().state::<services::AppState>();
            state.serve_preview(context.webview_label(), request)
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            shell_hide_wheel,
            shell_wheel_mode,
            services::bootstrap,
            services::inspect_paths,
            services::consume_drop,
            services::choose_files,
            services::choose_folder,
            services::pick_output,
            services::save_settings,
            services::enqueue,
            services::cancel,
            services::retry,
            services::copy_diagnostic,
            services::image_preview,
            services::preview,
            services::preview_context,
            services::close_preview,
            services::read_pdf,
            services::save_pdf_output,
            services::pdf_context,
            services::open_image_tool,
            services::open_video_tool,
            services::image_tool_context,
            services::apply_image_tool,
            services::close_image_tool,
            services::video_tool_context,
            services::apply_video_tool,
            services::close_video_tool,
            services::select_global_operation,
            services::handoff_global_files,
            services::finish_global_wheel,
            services::reveal,
            services::open_output,
            services::file_action,
        ])
        .setup(|app| {
            let state = services::AppState::load(app.handle())?;
            app.manage(state);
            #[cfg(windows)]
            windows_watcher::start(app.handle());
            let args = std::env::args().collect::<Vec<_>>();
            if handle_wheel_request(app.handle(), &args) {
                if let Some(workspace) = app.get_webview_window("workspace") {
                    let _ = workspace.hide();
                }
            }
            let workspace = MenuItem::with_id(app, "workspace", "Show Santra", true, None::<&str>)?;
            let wheel = MenuItem::with_id(app, "wheel", "Show citrus wheel", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&workspace, &wheel, &quit])?;
            if let Some(icon) = app.default_window_icon() {
                TrayIconBuilder::new()
                    .icon(icon.clone())
                    .tooltip("Santra")
                    .menu(&menu)
                    .on_menu_event(|app, event| {
                        if event.id().as_ref() == "quit" {
                            app.exit(0);
                        } else if let Some(window) = app.get_webview_window(event.id().as_ref()) {
                            if window.label() == "wheel" {
                                if let Err(error) = place_wheel(&window, None) {
                                    eprintln!("Santra wheel placement unavailable: {error}");
                                }
                            }
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if !window.label().starts_with("preview-") {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            WindowEvent::Destroyed => {
                window
                    .app_handle()
                    .state::<services::AppState>()
                    .forget_window(window.label());
            }
            WindowEvent::DragDrop(DragDropEvent::Enter { paths, .. }) => {
                if ["wheel", "workspace"].contains(&window.label()) {
                    let generation_counter = native_drag_generation(window.label());
                    let generation = generation_counter.fetch_add(1, Ordering::SeqCst) + 1;
                    let window = window.clone();
                    let paths = paths.clone();
                    tauri::async_runtime::spawn(async move {
                        let files = tauri::async_runtime::spawn_blocking(move || {
                            services::inspect_drag_paths(paths)
                        })
                        .await;
                        if generation != generation_counter.load(Ordering::SeqCst) {
                            return;
                        }
                        match files {
                            Ok(Ok(files)) => {
                                let _ = window.emit("santra:native-drag-enter", files);
                            }
                            _ => {
                                let _ = window.emit(
                                    "santra:native-drag-enter",
                                    Vec::<services::LocalFile>::new(),
                                );
                            }
                        }
                    });
                }
            }
            WindowEvent::DragDrop(DragDropEvent::Over { position }) => {
                if window.label() == "wheel" {
                    let point = position.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
                    let _ = window.emit(
                        "santra:native-drag-over",
                        serde_json::json!({ "x": point.x, "y": point.y }),
                    );
                }
            }
            WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) => {
                native_drag_generation(window.label()).fetch_add(1, Ordering::SeqCst);
                let app = window.app_handle();
                let state = app.state::<services::AppState>();
                if let Err(error) = state.record_drop(window.label(), paths) {
                    eprintln!("Santra drop rejected: {error}");
                    let _ = window.emit("santra:native-drop-error", error);
                } else {
                    let point = position.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
                    let _ = window.emit(
                        "santra:native-drop",
                        serde_json::json!({ "x": point.x, "y": point.y }),
                    );
                }
            }
            WindowEvent::DragDrop(DragDropEvent::Leave) => {
                native_drag_generation(window.label()).fetch_add(1, Ordering::SeqCst);
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("Santra failed to build")
        .run(|_app, event| {
            #[cfg(windows)]
            if matches!(event, tauri::RunEvent::Exit) {
                windows_watcher::stop(_app);
            }
            #[cfg(not(windows))]
            let _ = event;
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wheel_centers_on_cursor_and_clamps_to_monitor_work_area() {
        assert_eq!(
            centered_wheel_origin((900, 500), (520, 620), (0, 0, 1920, 1080)),
            (640, 190)
        );
        assert_eq!(
            centered_wheel_origin((5, 5), (520, 620), (0, 0, 1920, 1080)),
            (0, 0)
        );
        assert_eq!(
            centered_wheel_origin((1919, 1079), (520, 620), (0, 0, 1920, 1080)),
            (1400, 460)
        );
        assert_eq!(
            centered_wheel_origin((-900, 500), (520, 620), (-1920, 40, 1920, 1040)),
            (-1160, 190)
        );
        assert_eq!(
            centered_wheel_origin((150, 150), (520, 620), (0, 0, 320, 240)),
            (0, 0)
        );
        assert_eq!(
            centered_wheel_origin((1800, 1200), (1040, 1240), (0, 0, 3840, 2160)),
            (1280, 580)
        );
    }

    #[test]
    fn accepts_only_bounded_wheel_commands() {
        let args = vec![
            "santra".into(),
            "--santra-wheel-action=show".into(),
            "--santra-global-wheel=tools".into(),
            "--santra-wheel-x=-120".into(),
            "--santra-wheel-y=250".into(),
        ];
        assert_eq!(
            wheel_request(&args),
            Some(WheelRequest {
                action: "show",
                mode: Some("tools"),
                point: Some((-120, 250))
            })
        );
        assert!(wheel_request(&[
            "--santra-wheel-action=show".into(),
            "--santra-global-wheel=unknown".into()
        ])
        .is_none());
        assert_eq!(
            wheel_request(&[
                "--santra-wheel-action=hide".into(),
                "--santra-global-wheel=".into()
            ])
            .unwrap()
            .action,
            "hide"
        );
    }
}
