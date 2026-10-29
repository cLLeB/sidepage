// Asking an AI about the open book, through the AI's own command-line tool signed in with the reader's
// subscription: Claude Code (Claude Pro or Max), Codex (ChatGPT plans) or Gemini CLI (a Google account). No API
// key is involved. Only these three tools can be started, and their arguments are written here, not by the page:
// the AI may read and search the book's folder, nothing else.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Running(Mutex<HashMap<String, Child>>);

const TOOLS: [&str; 3] = ["claude", "codex", "gemini"];

// Where a tool is installed. An app started from the desktop does not get the shell's PATH (on a Mac above all),
// so the usual install places are looked in too.
fn find(tool: &str) -> Option<PathBuf> {
  let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default();
  let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
  dirs.push(home.join(".local").join("bin"));
  dirs.push(home.join(".claude").join("local"));
  dirs.push(home.join(".npm-global").join("bin"));
  dirs.push(home.join(".bun").join("bin"));
  if cfg!(windows) {
    if let Some(appdata) = std::env::var_os("APPDATA") { dirs.push(PathBuf::from(appdata).join("npm")); }
  } else {
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
  }
  let names: Vec<String> = if cfg!(windows) { vec![format!("{tool}.exe"), format!("{tool}.cmd")] } else { vec![tool.to_string()] };
  dirs.iter().flat_map(|dir| names.iter().map(move |name| dir.join(name))).find(|path| path.is_file())
}

fn command(path: &PathBuf, args: &[String]) -> Command {
  // A .cmd shim (tools installed with npm on Windows) is run through the command interpreter.
  let mut command = if path.extension().map_or(false, |ext| ext == "cmd") {
    let mut shell = Command::new("cmd");
    shell.arg("/C").arg(path).args(args);
    shell
  } else {
    let mut direct = Command::new(path);
    direct.args(args);
    direct
  };
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000); // no console window
  }
  command
}

#[tauri::command]
pub fn ai_tools() -> Vec<String> {
  TOOLS.iter().filter(|tool| find(tool).is_some()).map(|tool| tool.to_string()).collect()
}

// What each kind of request becomes, for each tool.
fn args_for(tool: &str, mode: &str, system: &str, resume: &str) -> Result<Vec<String>, String> {
  let owned = |list: &[&str]| list.iter().map(|part| part.to_string()).collect::<Vec<String>>();
  Ok(match (tool, mode) {
    ("claude", "ask") => {
      let mut args = owned(&["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--tools", "Read", "Grep", "Glob", "--permission-mode", "dontAsk", "--strict-mcp-config", "--append-system-prompt"]);
      args.push(system.to_string());
      if !resume.is_empty() { args.push("--resume".into()); args.push(resume.to_string()); }
      args
    }
    ("claude", "status") => owned(&["auth", "status"]),
    ("claude", "login") => owned(&["auth", "login"]),
    ("codex", "ask") => owned(&["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"]),
    ("codex", "status") => owned(&["login", "status"]),
    ("codex", "login") => owned(&["login"]),
    ("gemini", "ask") => owned(&["-p", "Answer the reader's question that follows, from the files in this folder."]),
    _ => return Err(format!("{tool} cannot do {mode}")),
  })
}

// Starts a request; its output comes back line by line as "ai-line" events, then one "ai-done".
#[tauri::command]
pub fn ai_start(app: AppHandle, running: State<Running>, id: String, tool: String, mode: String, input: String,
  cwd: String, system: String, resume: String) -> Result<(), String> {
  if !TOOLS.contains(&tool.as_str()) { return Err("unknown tool".into()); }
  let path = find(&tool).ok_or_else(|| format!("{tool} is not installed"))?;
  let mut command = command(&path, &args_for(&tool, &mode, &system, &resume)?);
  if !cwd.is_empty() { command.current_dir(&cwd); }
  let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
  if let Some(mut stdin) = child.stdin.take() {
    let _ = stdin.write_all(input.as_bytes());
  }
  let stdout = child.stdout.take().ok_or("no output")?;
  let mut stderr = child.stderr.take().ok_or("no output")?;
  running.0.lock().unwrap().insert(id.clone(), child);
  std::thread::spawn(move || {
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
      let _ = app.emit("ai-line", serde_json::json!({ "id": id, "line": line }));
    }
    let mut errors = String::new();
    let _ = stderr.read_to_string(&mut errors);
    let code = {
      let running = app.state::<Running>();
      let child = running.0.lock().unwrap().remove(&id);
      child.and_then(|mut child| child.wait().ok()).and_then(|status| status.code())
    };
    let _ = app.emit("ai-done", serde_json::json!({ "id": id, "code": code, "errors": errors }));
  });
  Ok(())
}

#[tauri::command]
pub fn ai_stop(running: State<Running>, id: String) {
  if let Some(mut child) = running.0.lock().unwrap().remove(&id) {
    let _ = child.kill();
  }
}

use tauri::Manager;
