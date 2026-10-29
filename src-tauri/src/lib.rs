use std::path::PathBuf;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![launch_file_name, read_launch_file])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
