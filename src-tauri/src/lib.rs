use std::path::PathBuf;
#[cfg(desktop)]
use tauri::{Emitter, Manager};

// The file Sidepage was started with, e.g. from "Open with" or a double-click.
fn launch_file() -> Option<PathBuf> {
  std::env::args_os().nth(1).map(PathBuf::from).filter(|path| path.is_file())
}

#[tauri::command]
fn launch_file_name() -> Option<String> {
  launch_file()?.file_name().map(|name| name.to_string_lossy().into_owned())
}

#[tauri::command]
fn read_launch_file() -> Result<tauri::ipc::Response, String> {
  let path = launch_file().ok_or("no file")?;
  std::fs::read(path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

// A file handed over by a second Sidepage (opened from Explorer while this one was already open).
#[tauri::command]
fn read_path(path: String) -> Result<tauri::ipc::Response, String> {
  std::fs::read(path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  // Only one Sidepage at a time on a computer: a second one brings the first to the front with its file.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.unminimize();
      let _ = window.set_focus();
    }
    if let Some(path) = argv.get(1).filter(|path| std::path::Path::new(path).is_file()) {
      let _ = app.emit("open-path", path.clone());
    }
  }));
  builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![launch_file_name, read_launch_file, read_path])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
