// Hide the extra console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fsops;

use fsops::{err, DirEntry, FileData, PluginSource, Stat, R};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Watching {
    watcher: Option<RecommendedWatcher>,
    paths: HashSet<PathBuf>,
}

/// What the host keeps for each editor window, by window label.
#[derive(Default)]
struct WindowState {
    /// Paths to open that the UI has not been told about yet: the command
    /// line, or files the OS asked us to open before the UI was listening.
    pending: Vec<String>,
    /// Set once the UI is listening for `close-requested`. Until then the
    /// window closes normally, so a UI that failed to start can still be shut.
    ready: bool,
    /// Directories this window wants watched.
    watched: HashSet<PathBuf>,
}

/// The window the app starts with. It alone restores the previous session.
const MAIN: &str = "main";

struct AppState {
    /// One watcher serves every window: it watches the union of their sets.
    watching: Mutex<Watching>,
    windows: Mutex<HashMap<String, WindowState>>,
    /// Label of the window that last had focus: where `fedit <path>` opens.
    last_focused: Mutex<String>,
    next_window: AtomicUsize,
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
    /// Whether this window should reopen the previous session.
    restore: bool,
}

#[tauri::command]
fn app_info(app: AppHandle, window: WebviewWindow, state: State<AppState>) -> AppInfo {
    let mut windows = state.windows.lock().unwrap();
    let paths = std::mem::take(&mut windows.entry(window.label().to_string()).or_default().pending);
    AppInfo {
        config_dir: fsops::config_dir().to_string_lossy().into_owned(),
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
        sep: std::path::MAIN_SEPARATOR.to_string(),
        home: std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default(),
        paths,
        restore: window.label() == MAIN,
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

/// Save what a window remembers into the shared state file. See `fsops::update_state`.
#[tauri::command]
async fn update_state(
    patch: serde_json::Map<String, serde_json::Value>,
    recents: Vec<fsops::RecentOp>,
) -> R<serde_json::Value> {
    fsops::update_state(&fsops::config_dir().join("state.json"), patch, &recents)
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

/// Point the watcher at the union of what the open windows want watched.
fn sync_watches(state: &AppState) {
    let wanted: HashSet<PathBuf> =
        state.windows.lock().unwrap().values().flat_map(|w| w.watched.iter().cloned()).collect();
    let mut w = state.watching.lock().unwrap();
    let stale: Vec<PathBuf> = w.paths.difference(&wanted).cloned().collect();
    let fresh: Vec<PathBuf> = wanted.difference(&w.paths).cloned().collect();
    let Some(watcher) = w.watcher.as_mut() else { return };
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
}

/// Replace this window's set of watched directories (non-recursive). The
/// frontend sends the expanded tree folders plus the folders of open files.
#[tauri::command]
fn watch_paths(paths: Vec<String>, window: WebviewWindow, state: State<AppState>) {
    state.windows.lock().unwrap().entry(window.label().to_string()).or_default().watched =
        paths.into_iter().map(PathBuf::from).collect();
    sync_watches(&state);
}

fn picked(path: Option<tauri_plugin_dialog::FilePath>) -> Option<String> {
    path.and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

fn dialog_at(window: &WebviewWindow, dir: Option<String>) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut d = window.dialog().file().set_parent(window);
    if let Some(dir) = dir.filter(|d| Path::new(d).is_dir()) {
        d = d.set_directory(dir);
    }
    d
}

#[tauri::command]
async fn pick_files(window: WebviewWindow, dir: Option<String>) -> Vec<String> {
    dialog_at(&window, dir)
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| picked(Some(p)))
        .collect()
}

#[tauri::command]
async fn pick_folder(window: WebviewWindow, dir: Option<String>) -> Option<String> {
    picked(dialog_at(&window, dir).blocking_pick_folder())
}

#[tauri::command]
async fn pick_save(window: WebviewWindow, dir: Option<String>, name: Option<String>) -> Option<String> {
    let mut d = dialog_at(&window, dir);
    if let Some(name) = name {
        d = d.set_file_name(name);
    }
    picked(d.blocking_save_file())
}

#[tauri::command]
fn set_title(window: WebviewWindow, title: String) {
    let _ = window.set_title(&title);
}

/// The UI is listening. Returns any paths that arrived since `app_info`.
#[tauri::command]
fn frontend_ready(window: WebviewWindow, state: State<AppState>) -> Vec<String> {
    let mut windows = state.windows.lock().unwrap();
    let w = windows.entry(window.label().to_string()).or_default();
    w.ready = true;
    std::mem::take(&mut w.pending)
}

/// The window that `fedit <path>` should open in: the one last focused.
fn target_window(app: &AppHandle) -> Option<WebviewWindow> {
    let last = app.state::<AppState>().last_focused.lock().unwrap().clone();
    app.get_webview_window(&last)
        .or_else(|| app.get_webview_window(MAIN))
        .or_else(|| app.webview_windows().into_values().next())
}

/// Hand paths to a window's UI now, or keep them until it is ready.
fn deliver_paths(app: &AppHandle, label: &str, paths: Vec<String>) {
    let state = app.state::<AppState>();
    let mut windows = state.windows.lock().unwrap();
    let w = windows.entry(label.to_string()).or_default();
    if w.ready {
        let _ = app.emit_to(label, "open-paths", paths);
    } else {
        w.pending.extend(paths);
    }
}

/// Open another editor window showing `paths` (none: an empty window).
fn open_window(app: &AppHandle, paths: Vec<String>) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let label = format!("w{}", state.next_window.fetch_add(1, Ordering::SeqCst));
    state.windows.lock().unwrap().insert(label.clone(), WindowState { pending: paths, ..Default::default() });
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Fedit")
        .inner_size(1100.0, 760.0)
        .min_inner_size(420.0, 300.0)
        .build();
    if built.is_err() {
        state.windows.lock().unwrap().remove(&label);
    }
    built.map(|_| ())
}

// Async: creating a window from a synchronous command deadlocks on Windows.
#[tauri::command]
async fn new_window(app: AppHandle, paths: Vec<String>) -> R<()> {
    open_window(&app, paths).map_err(err)
}

/// Close the calling window, without asking: the UI has already dealt with
/// unsaved changes. Closing the last window ends the app.
#[tauri::command]
fn close_window(app: AppHandle, window: WebviewWindow) {
    if app.webview_windows().len() <= 1 {
        app.exit(0);
    } else {
        let _ = window.destroy();
    }
}

/// Ask every window to close. Each prompts for its own unsaved changes; a
/// window whose UI never started is simply closed.
fn request_quit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let ready: HashSet<String> =
        state.windows.lock().unwrap().iter().filter(|(_, w)| w.ready).map(|(label, _)| label.clone()).collect();
    if ready.is_empty() {
        return app.exit(0);
    }
    for (label, window) in app.webview_windows() {
        if ready.contains(&label) {
            let _ = app.emit_to(label.as_str(), "close-requested", ());
        } else {
            let _ = window.destroy();
        }
    }
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
    request_quit(&app);
}

fn main() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let initial_paths = fsops::resolve_args(&args, &cwd);

    let mut builder = tauri::Builder::default();
    // A second `fedit <path>` hands its paths to the running app and exits:
    // to the window last used, or with `--new-window` to a window of their own.
    if std::env::var_os("FEDIT_NEW_INSTANCE").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let rest: Vec<String> = argv.into_iter().skip(1).collect();
            let paths = fsops::resolve_args(&rest, Path::new(&cwd));
            if rest.iter().any(|a| a == "--new-window" || a == "-n") {
                // Not from inside this callback: on Windows it runs in a
                // window-message handler, where creating a webview deadlocks.
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = open_window(&app, paths);
                });
            } else if let Some(w) = target_window(app) {
                // Queued if that window is still starting up.
                deliver_paths(app, w.label(), paths);
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
            windows: Mutex::new(HashMap::from([(
                MAIN.to_string(),
                WindowState { pending: initial_paths, ..Default::default() },
            )])),
            last_focused: Mutex::new(MAIN.to_string()),
            next_window: AtomicUsize::new(2),
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
            let state = window.state::<AppState>();
            match event {
                // The frontend owns the unsaved-changes prompt, then calls `close_window`.
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let ready = state.windows.lock().unwrap().get(window.label()).is_some_and(|w| w.ready);
                    if ready {
                        api.prevent_close();
                        let _ = window.app_handle().emit_to(window.label(), "close-requested", ());
                    }
                }
                tauri::WindowEvent::Focused(true) => {
                    *state.last_focused.lock().unwrap() = window.label().to_string();
                }
                tauri::WindowEvent::Destroyed => {
                    state.windows.lock().unwrap().remove(window.label());
                    sync_watches(&state);
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            read_file,
            write_file,
            update_state,
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
            new_window,
            close_window,
            clipboard_read,
            clipboard_write,
            quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building fedit")
        .run(|app, event| match event {
            // A quit that did not come from our own commands (the macOS app
            // menu or Dock, for instance) goes through the same unsaved-changes
            // prompts as closing each window. With no window left it is just
            // the app ending after its last window closed.
            tauri::RunEvent::ExitRequested { api, code: None, .. } => {
                let any_ready = app.state::<AppState>().windows.lock().unwrap().values().any(|w| w.ready);
                if any_ready && !app.webview_windows().is_empty() {
                    api.prevent_exit();
                    request_quit(app);
                }
            }
            // macOS delivers "open with" and file drops on the dock icon as an
            // event rather than as command-line arguments.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                let paths = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if let Some(w) = target_window(app) {
                    deliver_paths(app, w.label(), paths);
                }
            }
            _ => {}
        });
}
