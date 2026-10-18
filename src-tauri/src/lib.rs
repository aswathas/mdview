use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum DocKind {
    Markdown,
    Transcript,
}

#[derive(Serialize)]
struct LoadedDoc {
    path: String,
    kind: DocKind,
    text: String,
}

#[tauri::command]
fn open_path(path: String) -> Result<LoadedDoc, String> {
    let kind = match Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jsonl") => DocKind::Transcript,
        _ => DocKind::Markdown,
    };

    let bytes = fs::read(&path).map_err(|e| format!("{path}: {e}"))?;

    Ok(LoadedDoc {
        path,
        kind,
        // Transcripts echo arbitrary bytes; a single bad sequence must not blank the view.
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// argv[0] is the executable itself, so the first non-flag argument is the document.
fn argv_path(argv: &[String]) -> Option<String> {
    argv.iter()
        .skip(1)
        .find(|a| !a.starts_with('-'))
        .cloned()
}

#[tauri::command]
fn startup_path() -> Option<String> {
    argv_path(&std::env::args().collect::<Vec<_>>())
}

const OPEN_PATH_EVENT: &str = "mdview://open-path";

/// Run on the already-running instance. Focusing is best-effort: a minimized window that
/// refuses focus still gets the document, which is what the user actually asked for.
fn forward_to_existing(app: &AppHandle, argv: Vec<String>, _cwd: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(path) = argv_path(&argv) {
        let _ = app.emit(OPEN_PATH_EVENT, path);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: plugins initialize in registration order, and this one has to be
        // listening before any other plugin can spawn a second process.
        .plugin(tauri_plugin_single_instance::init(forward_to_existing))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![open_path, startup_path])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}