//! Filesystem operations behind the editor's commands. Pure std + a few small
//! crates, with no Tauri types, so everything here is unit-testable.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// Files larger than this are not loaded into the editor.
pub const MAX_TEXT_BYTES: u64 = 20 * 1024 * 1024;

pub type R<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    /// "text" | "binary" | "large"
    pub kind: &'static str,
    pub content: Option<String>,
    /// True when the bytes were not valid UTF-8 and were decoded lossily.
    pub lossy: bool,
    pub mtime: f64,
    pub size: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    /// "file" | "dir" | "none"
    pub kind: &'static str,
    pub mtime: f64,
    pub size: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PluginSource {
    pub name: String,
    pub path: String,
    pub source: Option<String>,
    pub error: Option<String>,
}

fn mtime_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

/// A NUL byte in the first 8 KiB marks a file as binary.
pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|b| *b == 0)
}

pub fn read_file(path: &Path) -> R<FileData> {
    let meta = fs::metadata(path).map_err(err)?;
    if meta.is_dir() {
        return Err(format!("{} is a directory", path.display()));
    }
    let (mtime, size) = (mtime_ms(&meta), meta.len());
    if size > MAX_TEXT_BYTES {
        return Ok(FileData { kind: "large", content: None, lossy: false, mtime, size });
    }
    let bytes = fs::read(path).map_err(err)?;
    if looks_binary(&bytes) {
        return Ok(FileData { kind: "binary", content: None, lossy: false, mtime, size });
    }
    let (content, lossy) = match String::from_utf8(bytes) {
        Ok(s) => (s, false),
        Err(e) => (String::from_utf8_lossy(e.as_bytes()).into_owned(), true),
    };
    Ok(FileData { kind: "text", content: Some(content), lossy, mtime, size })
}

/// Write through a temp file in the same directory and rename over the target,
/// so a crash mid-write never leaves a truncated file. Symlinks are followed
/// and the existing file's permissions are kept.
pub fn write_file(path: &Path, content: &str) -> R<f64> {
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let dir = target.parent().ok_or("path has no parent directory")?.to_path_buf();
    fs::create_dir_all(&dir).map_err(err)?;
    let name = target.file_name().ok_or("path has no file name")?.to_string_lossy().into_owned();
    // Unique per write: two windows saving the same file at once must not
    // share a staging file.
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!(".{}.fedit-{}-{}.tmp", name, std::process::id(), seq));

    let mut f = match fs::File::create(&tmp) {
        Ok(f) => f,
        Err(_) => {
            // No temp file can be made next to the target (a read-only
            // directory holding a writable file): writing in place is the
            // only way to save at all.
            fs::write(&target, content).map_err(err)?;
            return Ok(mtime_ms(&fs::metadata(&target).map_err(err)?));
        }
    };
    // Once staging has started, any failure (disk full, quota, sync error)
    // is reported with the original file left untouched. Falling back to an
    // in-place write here would truncate it and likely fail the same way.
    let staged = (|| -> std::io::Result<()> {
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        drop(f);
        if let Ok(meta) = fs::metadata(&target) {
            fs::set_permissions(&tmp, meta.permissions())?;
        }
        fs::rename(&tmp, &target)
    })();
    if let Err(e) = staged {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(mtime_ms(&fs::metadata(&target).map_err(err)?))
}

/// A change to the remembered recent files or folders.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum RecentOp {
    /// Move `path` to the front of `list`, keeping at most `max` entries.
    Add { list: String, path: String, max: usize },
    Remove { path: String },
    Clear,
}

const RECENT_LISTS: [&str; 2] = ["recentFiles", "recentFolders"];

fn recent_list<'a>(state: &'a mut Map<String, Value>, key: &str) -> &'a mut Vec<Value> {
    let slot = state.entry(key.to_string()).or_insert_with(|| Value::Array(Vec::new()));
    if !slot.is_array() {
        *slot = Value::Array(Vec::new());
    }
    slot.as_array_mut().unwrap()
}

/// Update the state file shared by every window, as one step: read it, apply
/// the recent-list changes, replace the top-level keys in `patch`, write it
/// back. Returns the state as written. Windows change the file only through
/// this, so one window never writes over what another just saved.
pub fn update_state(file: &Path, patch: Map<String, Value>, recents: &[RecentOp]) -> R<Value> {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // A missing or damaged file starts over; it only costs what was remembered.
    let mut state = fs::read_to_string(file)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    for op in recents {
        match op {
            RecentOp::Add { list, path, max } => {
                if !RECENT_LISTS.contains(&list.as_str()) {
                    return Err(format!("unknown recent list: {list}"));
                }
                let items = recent_list(&mut state, list);
                items.retain(|p| p.as_str() != Some(path.as_str()));
                items.insert(0, Value::String(path.clone()));
                items.truncate(*max);
            }
            RecentOp::Remove { path } => {
                for key in RECENT_LISTS {
                    recent_list(&mut state, key).retain(|p| p.as_str() != Some(path.as_str()));
                }
            }
            RecentOp::Clear => {
                for key in RECENT_LISTS {
                    recent_list(&mut state, key).clear();
                }
            }
        }
    }
    state.extend(patch);
    let state = Value::Object(state);
    write_file(file, &serde_json::to_string_pretty(&state).map_err(err)?)?;
    Ok(state)
}

pub fn read_dir(path: &Path) -> R<Vec<DirEntry>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(path).map_err(err)? {
        let Ok(entry) = entry else { continue };
        let p = entry.path();
        // Follow symlinks so a linked directory can be expanded.
        let is_dir = fs::metadata(&p).map(|m| m.is_dir()).unwrap_or(false);
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: p.to_string_lossy().into_owned(),
            is_dir,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(out)
}

/// Relative paths of files under `root` for quick open: honours .gitignore,
/// includes dotfiles, skips `.git` and `node_modules`.
pub fn list_files(root: &Path, limit: usize) -> Vec<String> {
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .require_git(false)
        .filter_entry(|e| {
            let n = e.file_name();
            n != ".git" && n != "node_modules"
        })
        .build();
    let mut out = Vec::new();
    for entry in walker.flatten() {
        if out.len() >= limit {
            break;
        }
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Ok(rel) = entry.path().strip_prefix(root) {
                out.push(rel.to_string_lossy().into_owned());
            }
        }
    }
    out.sort();
    out
}

pub fn stat(path: &Path) -> Stat {
    match fs::metadata(path) {
        Ok(m) => Stat {
            kind: if m.is_dir() { "dir" } else { "file" },
            mtime: mtime_ms(&m),
            size: m.len(),
        },
        Err(_) => Stat { kind: "none", mtime: 0.0, size: 0 },
    }
}

pub fn create_file(path: &Path) -> R<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::OpenOptions::new().write(true).create_new(true).open(path).map(|_| ()).map_err(err)
}

pub fn create_dir(path: &Path) -> R<()> {
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    fs::create_dir_all(path).map_err(err)
}

pub fn rename(from: &Path, to: &Path) -> R<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(format!("{} already exists", to.display()));
    }
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::rename(from, to).map_err(err)
}

/// The settings/keybindings/plugins directory. Must match `lib/paths.mjs`.
pub fn config_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("FEDIT_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(home);
    }
    if cfg!(windows) {
        if let Some(appdata) = std::env::var_os("APPDATA").filter(|v| !v.is_empty()) {
            return PathBuf::from(appdata).join("fedit");
        }
    }
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(xdg).join("fedit");
    }
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join(".config").join("fedit")
}

fn plugin_from_file(name: String, path: &Path) -> PluginSource {
    match fs::read_to_string(path) {
        Ok(source) => PluginSource {
            name,
            path: path.to_string_lossy().into_owned(),
            source: Some(source),
            error: None,
        },
        Err(e) => PluginSource {
            name,
            path: path.to_string_lossy().into_owned(),
            source: None,
            error: Some(e.to_string()),
        },
    }
}

/// Entry file of a plugin package directory: `fedit.main`, then `module`,
/// then `main`, then `index.js`.
fn package_entry(dir: &Path) -> R<PathBuf> {
    let raw = fs::read_to_string(dir.join("package.json")).map_err(|e| format!("package.json: {e}"))?;
    let pkg: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("package.json: {e}"))?;
    let entry = pkg
        .get("fedit")
        .and_then(|f| f.get("main"))
        .and_then(|v| v.as_str())
        .or_else(|| pkg.get("module").and_then(|v| v.as_str()))
        .or_else(|| pkg.get("main").and_then(|v| v.as_str()))
        .unwrap_or("index.js");
    Ok(dir.join(entry))
}

/// Plugins to load, in order:
/// 1. loose `.js`/`.mjs` files in `<config>/plugins`;
/// 2. packages installed there by `fedit plugin add` (the dependencies of
///    `<config>/plugins/package.json`);
/// 3. each `load` entry from settings: an absolute file, an absolute package
///    directory, or a package name under `<config>/plugins/node_modules`.
pub fn read_plugins(config: &Path, load: &[String]) -> Vec<PluginSource> {
    let plugins_dir = config.join("plugins");
    let mut out = Vec::new();

    let mut loose: Vec<PathBuf> = fs::read_dir(&plugins_dir)
        .map(|rd| rd.flatten().map(|e| e.path()).collect())
        .unwrap_or_default();
    loose.sort();
    for p in loose {
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if p.is_file() && (ext == "js" || ext == "mjs") {
            let name = p.file_stem().unwrap_or_default().to_string_lossy().into_owned();
            out.push(plugin_from_file(name, &p));
        }
    }

    let mut specs: Vec<String> = fs::read_to_string(plugins_dir.join("package.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|pkg| pkg.get("dependencies").and_then(|d| d.as_object()).map(|d| d.keys().cloned().collect()))
        .unwrap_or_default();
    specs.sort();
    for spec in load {
        if !specs.contains(spec) {
            specs.push(spec.clone());
        }
    }

    for spec in &specs {
        let as_path = PathBuf::from(spec);
        let target = if as_path.is_absolute() {
            as_path
        } else {
            plugins_dir.join("node_modules").join(spec)
        };
        if target.is_dir() {
            match package_entry(&target) {
                Ok(entry) => out.push(plugin_from_file(spec.clone(), &entry)),
                Err(e) => out.push(PluginSource {
                    name: spec.clone(),
                    path: target.to_string_lossy().into_owned(),
                    source: None,
                    error: Some(e),
                }),
            }
        } else {
            out.push(plugin_from_file(spec.clone(), &target));
        }
    }
    out
}

/// Turn command-line arguments into absolute paths, ignoring flags.
///
/// Paths are made absolute lexically, not canonicalized: on Windows
/// `canonicalize` returns `\\?\C:\…` verbatim paths, which would not match
/// the same file reached through a dialog or the tree.
pub fn resolve_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .filter(|a| !a.is_empty() && !a.starts_with('-'))
        .map(|a| {
            let p = PathBuf::from(a);
            let joined = if p.is_absolute() { p } else { cwd.join(p) };
            std::path::absolute(&joined).unwrap_or(joined).to_string_lossy().into_owned()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("fedit-test-{}-{}", std::process::id(), name));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn text_binary_and_lossy_detection() {
        let d = tmp("detect");
        fs::write(d.join("a.txt"), "héllo\n").unwrap();
        fs::write(d.join("b.bin"), [0x89, b'P', b'N', b'G', 0, 1, 2]).unwrap();
        fs::write(d.join("c.txt"), [b'c', b'a', b'f', 0xE9]).unwrap();

        let a = read_file(&d.join("a.txt")).unwrap();
        assert_eq!((a.kind, a.lossy), ("text", false));
        assert_eq!(a.content.as_deref(), Some("héllo\n"));
        assert_eq!(read_file(&d.join("b.bin")).unwrap().kind, "binary");
        let c = read_file(&d.join("c.txt")).unwrap();
        assert_eq!((c.kind, c.lossy), ("text", true));
        assert!(read_file(&d).is_err());
    }

    #[test]
    fn write_is_atomic_and_keeps_permissions() {
        let d = tmp("write");
        let f = d.join("sub/x.txt");
        write_file(&f, "one").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "one");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&f, fs::Permissions::from_mode(0o750)).unwrap();
            write_file(&f, "two").unwrap();
            assert_eq!(fs::metadata(&f).unwrap().permissions().mode() & 0o777, 0o750);
        }
        write_file(&f, "three").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "three");
        let leftovers: Vec<_> = fs::read_dir(d.join("sub")).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1, "temp file must not be left behind");
    }

    #[cfg(unix)]
    #[test]
    fn failed_staging_leaves_the_original_intact() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp("staging");
        let f = d.join("keep.txt");
        fs::write(&f, "original").unwrap();
        // The temp file can be created but not renamed over a directory
        // target stand-in: make the rename fail by pointing at a directory.
        let dir_target = d.join("adir");
        fs::create_dir(&dir_target).unwrap();
        fs::write(dir_target.join("inner"), "x").unwrap();
        assert!(write_file(&dir_target, "new").is_err());
        assert!(dir_target.join("inner").exists(), "target untouched after a failed save");
        let leftovers = fs::read_dir(&d).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().contains(".fedit-")).count();
        assert_eq!(leftovers, 0, "temp file removed after a failed save");

        // A read-only directory still allows saving a writable file in place.
        fs::set_permissions(&d, fs::Permissions::from_mode(0o555)).unwrap();
        let result = write_file(&f, "in place");
        fs::set_permissions(&d, fs::Permissions::from_mode(0o755)).unwrap();
        result.unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "in place");
    }

    #[cfg(unix)]
    #[test]
    fn write_follows_symlinks() {
        let d = tmp("symlink");
        fs::write(d.join("real.txt"), "a").unwrap();
        std::os::unix::fs::symlink(d.join("real.txt"), d.join("link.txt")).unwrap();
        write_file(&d.join("link.txt"), "b").unwrap();
        assert_eq!(fs::read_to_string(d.join("real.txt")).unwrap(), "b");
        assert!(fs::symlink_metadata(d.join("link.txt")).unwrap().file_type().is_symlink());
    }

    #[test]
    fn read_dir_sorts_directories_first() {
        let d = tmp("readdir");
        fs::write(d.join("b.txt"), "").unwrap();
        fs::write(d.join("A.txt"), "").unwrap();
        fs::create_dir(d.join("zdir")).unwrap();
        let names: Vec<String> = read_dir(&d).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["zdir", "A.txt", "b.txt"]);
    }

    #[test]
    fn list_files_honours_gitignore_and_skips_vcs() {
        let d = tmp("list");
        fs::create_dir_all(d.join("src")).unwrap();
        fs::create_dir_all(d.join(".git")).unwrap();
        fs::create_dir_all(d.join("node_modules/x")).unwrap();
        fs::write(d.join(".gitignore"), "out.log\n").unwrap();
        fs::write(d.join("src/main.rs"), "").unwrap();
        fs::write(d.join("out.log"), "").unwrap();
        fs::write(d.join(".git/HEAD"), "").unwrap();
        fs::write(d.join("node_modules/x/i.js"), "").unwrap();
        let sep = std::path::MAIN_SEPARATOR;
        assert_eq!(list_files(&d, 100), [".gitignore".to_string(), format!("src{sep}main.rs")]);
        assert_eq!(list_files(&d, 1).len(), 1);
    }

    #[test]
    fn create_and_rename_refuse_to_clobber() {
        let d = tmp("create");
        create_file(&d.join("a/b.txt")).unwrap();
        assert!(create_file(&d.join("a/b.txt")).is_err());
        create_dir(&d.join("dir")).unwrap();
        assert!(create_dir(&d.join("dir")).is_err());
        fs::write(d.join("c.txt"), "c").unwrap();
        assert!(rename(&d.join("c.txt"), &d.join("a/b.txt")).is_err());
        rename(&d.join("c.txt"), &d.join("new/d.txt")).unwrap();
        assert_eq!(stat(&d.join("new/d.txt")).kind, "file");
        assert_eq!(stat(&d.join("c.txt")).kind, "none");
        assert_eq!(stat(&d.join("dir")).kind, "dir");
    }

    #[test]
    fn plugins_from_folder_and_packages() {
        let d = tmp("plugins");
        let p = d.join("plugins");
        fs::create_dir_all(p.join("node_modules/pkg/lib")).unwrap();
        fs::write(p.join("b.js"), "B").unwrap();
        fs::write(p.join("a.mjs"), "A").unwrap();
        fs::write(p.join("notes.txt"), "no").unwrap();
        fs::write(p.join("node_modules/pkg/package.json"), r#"{"main":"x.js","fedit":{"main":"lib/p.js"}}"#).unwrap();
        fs::write(p.join("node_modules/pkg/lib/p.js"), "P").unwrap();
        let abs = d.join("solo.js");
        fs::write(&abs, "S").unwrap();
        // `fedit plugin add` records installed packages here; they load without a settings entry.
        fs::create_dir_all(p.join("node_modules/@scope/auto")).unwrap();
        fs::write(p.join("package.json"), r#"{"dependencies":{"pkg":"1.0.0","@scope/auto":"2.0.0"}}"#).unwrap();
        fs::write(p.join("node_modules/@scope/auto/package.json"), r#"{"module":"m.js"}"#).unwrap();
        fs::write(p.join("node_modules/@scope/auto/m.js"), "AUTO").unwrap();

        let got = read_plugins(&d, &["pkg".into(), abs.to_string_lossy().into_owned(), "missing".into()]);
        let view: Vec<(&str, Option<&str>)> = got.iter().map(|g| (g.name.as_str(), g.source.as_deref())).collect();
        assert_eq!(view[0], ("a", Some("A")));
        assert_eq!(view[1], ("b", Some("B")));
        assert_eq!(view[2], ("@scope/auto", Some("AUTO")));
        assert_eq!(view[3], ("pkg", Some("P")), "listed in both places, loaded once");
        assert_eq!(view[4].1, Some("S"));
        assert!(got[5].source.is_none() && got[5].error.is_some());
        assert_eq!(got.len(), 6);
    }

    #[test]
    fn args_resolve_against_cwd_and_drop_flags() {
        let d = tmp("args");
        let d = fs::canonicalize(d).unwrap();
        fs::write(d.join("f.txt"), "").unwrap();
        let got = resolve_args(&["--flag".into(), "f.txt".into(), "sub/../nope.txt".into()], &d);
        assert_eq!(got[0], d.join("f.txt").to_string_lossy());
        assert!(Path::new(&got[1]).is_absolute() && got[1].ends_with("nope.txt"));
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn state_updates_merge_instead_of_overwriting() {
        let d = tmp("state");
        let file = d.join("state.json");
        let add = |list: &str, path: &str| RecentOp::Add { list: list.into(), path: path.into(), max: 3 };
        let patch = |v: Value| v.as_object().cloned().unwrap();

        // The first window saves its session and a recent file.
        update_state(&file, patch(serde_json::json!({ "session": { "files": ["/a"] }, "zoom": 1 })), &[add("recentFiles", "/a")]).unwrap();
        // A second window knows nothing of that, and sends no session.
        let out = update_state(&file, patch(serde_json::json!({ "zoom": 2 })), &[add("recentFiles", "/b"), add("recentFolders", "/dir")]).unwrap();
        assert_eq!(out["recentFiles"], serde_json::json!(["/b", "/a"]));
        assert_eq!(out["recentFolders"], serde_json::json!(["/dir"]));
        assert_eq!(out["session"]["files"], serde_json::json!(["/a"]));
        assert_eq!(out["zoom"], 2);
        assert_eq!(serde_json::from_str::<Value>(&fs::read_to_string(&file).unwrap()).unwrap(), out);

        // Re-adding moves to the front; the list is capped; remove and clear work.
        let out = update_state(&file, Map::new(), &[add("recentFiles", "/c"), add("recentFiles", "/d"), add("recentFiles", "/a")]).unwrap();
        assert_eq!(out["recentFiles"], serde_json::json!(["/a", "/d", "/c"]));
        let out = update_state(&file, Map::new(), &[RecentOp::Remove { path: "/d".into() }]).unwrap();
        assert_eq!(out["recentFiles"], serde_json::json!(["/a", "/c"]));
        let out = update_state(&file, Map::new(), &[RecentOp::Clear]).unwrap();
        assert_eq!(out["recentFiles"], serde_json::json!([]));
        assert!(update_state(&file, Map::new(), &[add("session", "/x")]).is_err());

        // A damaged file is replaced rather than failing every save.
        fs::write(&file, "{ not json").unwrap();
        let out = update_state(&file, Map::new(), &[add("recentFiles", "/z")]).unwrap();
        assert_eq!(out["recentFiles"], serde_json::json!(["/z"]));
    }

    #[test]
    fn concurrent_writes_to_one_file_do_not_mix() {
        let d = tmp("concurrent");
        let file = d.join("same.txt");
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let file = file.clone();
                std::thread::spawn(move || {
                    let body = i.to_string().repeat(200_000);
                    for _ in 0..5 {
                        write_file(&file, &body).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let got = fs::read_to_string(&file).unwrap();
        assert_eq!(got.len(), 200_000);
        assert!(got.chars().all(|c| c == got.chars().next().unwrap()), "content from two writers was mixed");
    }
}
