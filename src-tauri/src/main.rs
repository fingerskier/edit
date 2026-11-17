// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fsops;

use fsops::{err, DirEntry, FileData, PluginSource, Stat, R};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Watching {
    watcher: Option<RecommendedWatcher>,
    paths: HashSet<PathBuf>,
}

struct AppState {
    watching: Mutex<Watching>,
    /// Paths given on the command line of the first instance.
    initial_paths: Vec<String>,
    /// Set once the UI is listening for `close-requested`. Until then the
    /// window closes normally, so a UI that failed to start can still be shut.
    frontend_ready: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    config_dir: String,
    version: String,
    platform: &'static str,
    sep: String,
    home: String,
    paths: Vec<String>,
}

#[tauri::command]
fn app_info(app: AppHandle, state: State<AppState>) -> AppInfo {
    AppInfo {
        config_dir: fsops::config_dir().to_string_lossy().into_owned(),
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        sep: std::path::MAIN_SEPARATOR.to_string(),
        home: std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default(),
        paths: state.initial_paths.clone(),
    }
}

#[tauri::command]
async fn read_file(path: String) -> R<FileData> {
    fsops::read_file(Path::new(&path))
}

#[tauri::command]
async fn write_file(path: String, content: String) -> R<f64> {
    fsops::write_file(Path::new(&path), &content)
}

#[tauri::command]
async fn read_dir(path: String) -> R<Vec<DirEntry>> {
    fsops::read_dir(Path::new(&path))
}

#[tauri::command]
async fn list_files(root: String, limit: usize) -> Vec<String> {
    fsops::list_files(Path::new(&root), limit)
}

#[tauri::command]
async fn stat(path: String) -> Stat {
    fsops::stat(Path::new(&path))
}

#[tauri::command]
async fn create_file(path: String) -> R<()> {
    fsops::create_file(Path::new(&path))
}

#[tauri::command]
async fn create_dir(path: String) -> R<()> {
    fsops::create_dir(Path::new(&path))
}

#[tauri::command]
async fn rename_path(from: String, to: String) -> R<()> {
    fsops::rename(Path::new(&from), Path::new(&to))
}

#[tauri::command]
async fn trash_path(path: String) -> R<()> {
    trash::delete(&path).map_err(err)
}

#[tauri::command]
async fn open_external(path: String) -> R<()> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(err)
}

#[tauri::command]
async fn reveal_path(path: String) -> R<()> {
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(err)
}

#[tauri::command]
async fn read_plugins(load: Vec<String>) -> Vec<PluginSource> {
    fsops::read_plugins(&fsops::config_dir(), &load)
}

/// Replace the set of watched directories (non-recursive). The frontend sends
/// the expanded tree folders plus the folders of open files.
#[tauri::command]
fn watch_paths(paths: Vec<String>, state: State<AppState>) -> R<()> {
    let mut w = state.watching.lock().map_err(err)?;
    let wanted: HashSet<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let stale: Vec<PathBuf> = w.paths.difference(&wanted).cloned().collect();
    let fresh: Vec<PathBuf> = wanted.difference(&w.paths).cloned().collect();
    let Some(watcher) = w.watcher.as_mut() else { return Ok(()) };
    let mut kept = Vec::new();
    for p in &stale {
        let _ = watcher.unwatch(p);
    }
    for p in fresh {
        // A folder can vanish between listing and watching; that is not an error.
        if watcher.watch(&p, RecursiveMode::NonRecursive).is_ok() {
            kept.push(p);
        }
    }
    for p in stale {
        w.paths.remove(&p);
    }
    w.paths.extend(kept);
    Ok(())
}

fn picked(path: Option<tauri_plugin_dialog::FilePath>) -> Option<String> {
    path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

fn dialog_at(app: &AppHandle, dir: Option<String>) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut d = app.dialog().file();
    if let Some(dir) = dir.filter(|d| Path::new(d).is_dir()) {
        d = d.set_directory(dir);
    }
    d
}

#[tauri::command]
async fn pick_files(app: AppHandle, dir: Option<String>) -> Vec<String> {
    dialog_at(&app, dir)
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| picked(Some(p)))
        .collect()
}

#[tauri::command]
async fn pick_folder(app: AppHandle, dir: Option<String>) -> Option<String> {
    picked(dialog_at(&app, dir).blocking_pick_folder())
}

#[tauri::command]
async fn pick_save(app: AppHandle, dir: Option<String>, name: Option<String>) -> Option<String> {
    let mut d = dialog_at(&app, dir);
    if let Some(name) = name {
        d = d.set_file_name(name);
    }
    picked(d.blocking_save_file())
}

#[tauri::command]
fn set_title(app: AppHandle, title: String) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_title(&title);
    }
}

#[tauri::command]
fn frontend_ready(state: State<AppState>) {
    state.frontend_ready.store(true, Ordering::SeqCst);
}

#[tauri::command]
async fn clipboard_read(app: AppHandle) -> String {
    // An empty or non-text clipboard reads as nothing to paste.
    app.clipboard().read_text().unwrap_or_default()
}

#[tauri::command]
async fn clipboard_write(app: AppHandle, text: String) -> R<()> {
    app.clipboard().write_text(text).map_err(err)
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn main() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let initial_paths = fsops::resolve_args(&args, &cwd);

    let mut builder = tauri::Builder::default();
    // A second `fedit <path>` hands its paths to the running window and exits.
    if std::env::var_os("FEDIT_NEW_INSTANCE").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let rest: Vec<String> = argv.into_iter().skip(1).collect();
            let paths = fsops::resolve_args(&rest, Path::new(&cwd));
            let _ = app.emit("open-paths", paths);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            watching: Mutex::new(Watching::default()),
            initial_paths,
            frontend_ready: AtomicBool::new(false),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                if let Ok(event) = res {
                    if matches!(event.kind, notify::EventKind::Access(_)) {
                        return;
                    }
                    let paths: Vec<String> =
                        event.paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
                    let _ = handle.emit("fs-changed", paths);
                }
            });
            if let Ok(watcher) = watcher {
                app.state::<AppState>().watching.lock().unwrap().watcher = Some(watcher);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // The frontend owns the unsaved-changes prompt, then calls `quit`.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<AppState>().frontend_ready.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("close-requested", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            read_file,
            write_file,
            read_dir,
            list_files,
            stat,
            create_file,
            create_dir,
            rename_path,
            trash_path,
            open_external,
            reveal_path,
            read_plugins,
            watch_paths,
            pick_files,
            pick_folder,
            pick_save,
            set_title,
            frontend_ready,
            clipboard_read,
            clipboard_write,
            quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running fedit");
}
