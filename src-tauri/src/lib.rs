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

// A folder the reader opened in Sidepage: its readable files and subfolders, as a tree (hidden folders and the
// usual heaps of program files left out, at most a few thousand entries).
#[derive(serde::Serialize)]
struct Entry { id: String, name: String, children: Option<Vec<Entry>>, size: u64 }

fn walk(root: &std::path::Path, dir: &std::path::Path, kinds: &[String], depth: u32, budget: &mut u32) -> Vec<Entry> {
  let mut found = Vec::new();
  if depth > 8 || *budget == 0 { return found; }
  let Ok(read) = std::fs::read_dir(dir) else { return found };
  let mut items: Vec<_> = read.flatten().collect();
  items.sort_by_key(|item| item.file_name().to_string_lossy().to_lowercase());
  for item in items {
    if *budget == 0 { break; }
    let name = item.file_name().to_string_lossy().into_owned();
    if name.starts_with('.') || ["node_modules", "$RECYCLE.BIN", "System Volume Information"].contains(&name.as_str()) { continue; }
    let path = item.path();
    let id = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
    if path.is_dir() {
      let children = walk(root, &path, kinds, depth + 1, budget);
      if !children.is_empty() { found.push(Entry { id, name, children: Some(children), size: 0 }); }
    } else if kinds.iter().any(|kind| name.to_lowercase().ends_with(&format!(".{kind}"))) {
      *budget -= 1;
      found.push(Entry { id, name, children: None, size: item.metadata().map(|m| m.len()).unwrap_or(0) });
    }
  }
  found
}

#[tauri::command]
fn list_folder(path: String, kinds: Vec<String>) -> Result<Vec<Entry>, String> {
  let root = std::path::PathBuf::from(&path);
  if !root.is_dir() { return Err("This folder is not there any more.".into()); }
  let mut budget = 5000;
  Ok(walk(&root, &root, &kinds, 0, &mut budget))
}

// The AI commands exist on computers only: a phone cannot start other programs.
#[cfg(desktop)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
  tauri::generate_handler![take_opened, read_path, list_folder, ai::ai_tools, ai::ai_start, ai::ai_stop]
}
#[cfg(mobile)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
  tauri::generate_handler![take_opened, read_path, list_folder]
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
