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

// Sharing a book: a copy is put under its own name in Sidepage's cache, where the phone's share sheet (Android)
// or the clipboard (a computer) can hand it to WhatsApp, an email or anything else. Its path is given back.
#[tauri::command]
fn share_file(app: tauri::AppHandle, request: tauri::ipc::Request) -> Result<String, String> {
  use tauri::Manager;
  let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("no file given".into()) };
  let name = request.headers().get("name").and_then(|v| v.to_str().ok()).unwrap_or("book");
  let name = percent_decode(name).replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
  let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("share");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let path = dir.join(if name.trim().is_empty() { "book".to_string() } else { name });
  std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}
fn percent_decode(text: &str) -> String {
  let bytes = text.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      if let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16) { out.push(byte); i += 3; continue; }
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

// On a computer, the file itself is put on the clipboard, as the file manager's Copy does: pasted into WhatsApp,
// an email or a chat, it arrives as the file.
#[cfg(desktop)]
#[tauri::command]
fn copy_file(path: String) -> Result<(), String> {
  use std::process::Command;
  #[cfg(windows)]
  let done = {
    use std::os::windows::process::CommandExt;
    Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -LiteralPath $env:SIDEPAGE_SHARE"])
      .env("SIDEPAGE_SHARE", &path).creation_flags(0x0800_0000).status().map(|s| s.success()).unwrap_or(false)
  };
  #[cfg(target_os = "macos")]
  let done = Command::new("osascript").args(["-e", "on run argv", "-e", "set the clipboard to (POSIX file (item 1 of argv))", "-e", "end run", &path])
    .status().map(|s| s.success()).unwrap_or(false);
  #[cfg(all(unix, not(target_os = "macos")))]
  let done = {
    use std::io::Write;
    use std::process::Stdio;
    let list = format!("file://{}
", path.replace(' ', "%20"));
    let tries: [(&str, &[&str]); 2] = [("wl-copy", &["-t", "text/uri-list"]), ("xclip", &["-selection", "clipboard", "-t", "text/uri-list", "-i"])];
    tries.iter().any(|(tool, args)| {
      Command::new(tool).args(*args).stdin(Stdio::piped()).spawn().ok().map(|mut child| {
        let _ = child.stdin.take().map(|mut input| input.write_all(list.as_bytes()));
        child.wait().map(|s| s.success()).unwrap_or(false)
      }).unwrap_or(false)
    })
  };
  if done { Ok(()) } else { Err("the clipboard could not take the file".into()) }
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
  tauri::generate_handler![take_opened, read_path, list_folder, share_file, copy_file, ai::ai_tools, ai::ai_start, ai::ai_stop]
}
#[cfg(mobile)]
fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool {
  tauri::generate_handler![take_opened, read_path, list_folder, share_file]
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
  let builder = builder
    .manage(ai::Running::default())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init());
  builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(handlers())
    .setup(|_app| {
      // A pinch on a Windows touchpad or touch screen would otherwise magnify the whole window (the web view's own
      // pinch zoom) and cut its edges off: Sidepage zooms the page under the fingers itself (see src/lib/pinch.ts).
      #[cfg(windows)]
      if let Some(window) = _app.get_webview_window("main") {
        let _ = window.with_webview(|webview| unsafe {
          use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
          use windows::core::Interface;
          if let Ok(core) = webview.controller().CoreWebView2() {
            if let Ok(settings) = core.Settings() {
              if let Ok(settings) = settings.cast::<ICoreWebView2Settings5>() {
                let _ = settings.SetIsPinchZoomEnabled(false);
              }
            }
          }
        });
      }
      Ok(())
    })
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
