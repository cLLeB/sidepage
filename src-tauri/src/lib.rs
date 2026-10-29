#[cfg(desktop)]
mod ai;
use std::sync::Mutex;
#[cfg(desktop)]
use tauri::{Emitter, Manager};

// Files the reader opened with Sidepage from outside (a double-click, "Open with", a file dropped on the Dock
// icon) and the page has not taken yet. On Windows and Linux they come as the program's arguments, from the first
// copy started or from a second one; on macOS the system hands them over in an "Opened" event. The page takes
// them with `take_opened`, at start and whenever an "open-pending" event says there are more.
static OPENED: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn remember(path: &str) {
  if std::path::Path::new(path).is_file() {
    OPENED.lock().unwrap().push(path.to_string());
  }
}

#[tauri::command]
fn take_opened() -> Vec<String> {
  std::mem::take(&mut *OPENED.lock().unwrap())
}

// A file's bytes: one opened from outside, or one Android copied into the app's own space.
#[tauri::command]
fn read_path(path: String) -> Result<tauri::ipc::Response, String> {
  std::fs::read(path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

// The AI commands exist on computers only: a phone cannot start other programs.
#[cfg(desktop)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
  tauri::generate_handler![take_opened, read_path, ai::ai_tools, ai::ai_start, ai::ai_stop]
}
#[cfg(mobile)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
  tauri::generate_handler![take_opened, read_path]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  if let Some(path) = std::env::args().nth(1) {
    remember(&path);
  }
  let builder = tauri::Builder::default();
  // Only one Sidepage at a time on a computer: a second one brings the first to the front with its file.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.unminimize();
      let _ = window.set_focus();
    }
    if let Some(path) = argv.get(1) {
      remember(path);
      let _ = app.emit("open-pending", ());
    }
  }));
  #[cfg(desktop)]
  let builder = builder.manage(ai::Running::default());
  builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(handlers())
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, _event| {
      // macOS hands files over in an event, at start and while running.
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Opened { urls } = _event {
        for url in urls {
          if let Ok(path) = url.to_file_path() {
            remember(&path.to_string_lossy());
          }
        }
        let _ = _app.emit("open-pending", ());
      }
    });
}
