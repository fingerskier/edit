# SPECIFICATION

## 1. Vision
Build **`edit`**, a lightning-fast, cross-platform, ultra-simple text editor distributed as an **`npx` binary**.

Primary goals:
- Open instantly and stay responsive on large files/projects.
- Work the same on macOS, Linux, and Windows.
- Keep UI and workflow minimal: one active editor pane + always-visible file tree.
- Be keyboard-first, with complete hotkey customization.

Non-goals (v1):
- Multi-pane code editing.
- Heavy IDE project modeling.
- Rich WYSIWYG features.

---

## 2. Product Scope (from README)
Required capabilities:
- Multiple cursors
- Always-on collapsible file tree
- Keyboard-driven UX
- Customizable hotkeys
- Clipboard history
- Fuzzy search
- Multi-directory workspaces
- File watcher auto updates
- Auto-save
- Full undo/redo across all operations
- LSP for syntax highlighting, symbol linking, and introspection
- Theme editing
- Command palette and chained hotkeys
- Piece-table text buffering

Trade-off constraints:
- Directory tree is always visible.
- Exactly one active file editor at a time.
- Mouse support is minimal/basic.

---

## 3. Distribution and Runtime

### 3.1 npx-first delivery
- Package published to npm as `edit`.
- Executable entrypoint exposed via `bin` field in `package.json`.
- Invocation pattern:
  - `npx edit`
  - `npx edit <path>`
  - `npx edit <path1> <path2> ...` (multi-root workspace)

### 3.2 Runtime model
Recommended architecture:
- **Node.js + TypeScript** for orchestration, plugin/lsp/file-io portability, and npm distribution.
- **Terminal UI (TUI)** renderer for true cross-platform consistency and speed in CLI context.

Rationale:
- `npx` naturally runs Node binaries.
- TUI avoids complex native GUI packaging in v1 while preserving keyboard-centric workflow.

---

## 4. High-Level Architecture

## 4.1 Core modules
1. **CLI Bootstrap**
   - Parse args, resolve workspace roots, load config, initialize subsystems.
2. **Event Bus / Command Engine**
   - Central command dispatch (keymap, palette, mouse basics).
3. **State Store**
   - Immutable-ish app state snapshots + transactional updates.
4. **Editor Engine**
   - Piece-table text model, selections/cursors, edits, undo/redo.
5. **Workspace Service**
   - Tree model, file operations, watchers, path indexing.
6. **Search Service**
   - In-file and workspace fuzzy search.
7. **LSP Client Service**
   - Language server lifecycle, diagnostics, symbols, go-to-definition.
8. **Persistence Service**
   - Auto-save, session restore, config/theme/keymap storage.
9. **UI Renderer**
   - File tree pane, editor pane, status line, command palette overlays.

### 4.2 Process model
Single process initially, with optional worker threads for:
- Fuzzy indexing/search
- LSP I/O isolation
- Heavy file tree refresh operations

---

## 5. UX and Interaction Design

### 5.1 Layout
Fixed layout:
- Left: collapsible directory tree (always present)
- Right: single active file editor
- Bottom/status: mode, cursor position, dirty state, diagnostics count
- Overlay: command palette

### 5.2 Keyboard model
- Every user action maps to a command id (`editor.move.left`, `tree.toggleNode`, etc.).
- Keybindings resolve to command ids with context predicates.
- Chained hotkeys supported as sequences (`ctrl+k`, then `ctrl+s`).

### 5.3 Mouse model
- Support only essential actions:
  - Focus pane
  - Place cursor
  - Expand/collapse tree node
  - Scroll

---

## 6. Data Structures and Algorithms

### 6.1 Text buffer: piece table (required)
- Original file content stored read-only in **original buffer**.
- User inserts appended to **add buffer**.
- Visible document represented by ordered piece descriptors:
  - `source` (original|add), `start`, `length`.
- Edits mutate piece list only; avoids full-string copying.

Performance targets:
- Typing latency < 5 ms median command-to-render on typical files.
- Insert/delete operations amortized near O(log n) or O(n) small constants depending on internal index strategy.

Recommended enhancements:
- Balanced tree / skip list over piece descriptors for efficient cursor offset lookups.
- Line index cache for row/col mapping.

### 6.2 Undo/redo model (full operation coverage)
- Command log with inverse operations.
- Group typing bursts into coalesced transactions.
- Global history includes:
  - text edits
  - cursor changes (optional coalescing)
  - file rename/create/delete
  - tree operations that alter workspace state

### 6.3 Multiple cursors
- Cursor set represented as sorted non-overlapping selections.
- Normalize overlaps after each operation.
- Apply edits in reverse document order to keep offsets stable.

### 6.4 Fuzzy search
- Use scoring algorithm (e.g., subsequence + boundary bonuses).
- Precompute lowercase and path segment tokens for tree/workspace search.
- Incremental results streamed to UI.

---

## 7. Workspace and File System

### 7.1 Multi-root workspace
- Accept N root directories.
- Unified virtual tree with root labels.
- Root-local ignore support via `.gitignore` parsing (v1 optional but recommended).

### 7.2 File watcher
- Cross-platform watcher abstraction (fs events + polling fallback).
- Debounce change storms.
- On external modification:
  - if file clean: reload automatically
  - if dirty: show conflict prompt in status/palette

### 7.3 Auto-save
- Configurable debounce (default 500–1000 ms).
- Save only dirty buffers.
- Atomic write strategy:
  - write temp file
  - fsync
  - rename replace

---

## 8. LSP Integration

### 8.1 Protocol support (v1)
- Initialize/shutdown server per language.
- Text document sync (incremental preferred).
- Publish diagnostics.
- Definition/references/hover.
- Document symbols for quick navigation.

### 8.2 Highlighting strategy
- Prefer semantic tokens when available.
- Fallback to TextMate/tree-sitter/token regex pipeline.

### 8.3 Resilience
- Server crash isolation and restart policy.
- Timeouts and stale response guards.

---

## 9. Configuration and Theming

### 9.1 Config files
Suggested precedence:
1. CLI args
2. Workspace config (`.edit/config.json`)
3. User config (`~/.edit/config.json`)
4. Defaults

### 9.2 Keymaps
- JSON/YAML keymap file mapping sequences to command ids.
- Conflict detection with warnings.

### 9.3 Theme editing
- Theme schema tokens:
  - background/foreground
  - tree colors
  - cursor/selection
  - diagnostics levels
  - syntax token classes
- Live theme reload on file save.

---

## 10. CLI Spec

### 10.1 Command syntax
- `edit [paths...]`
- `edit --help`
- `edit --version`
- `edit --config <path>`
- `edit --theme <path>`
- `edit --no-lsp`

### 10.2 Exit codes
- `0` success
- `1` generic failure
- `2` invalid args/config
- `3` runtime dependency failure (e.g., terminal capability missing)

---

## 11. Performance and Reliability Requirements

### 11.1 Startup
- Cold start target: < 150 ms to first frame on mid-range hardware (without LSP warmup).

### 11.2 Editing
- No dropped keypresses under sustained typing.
- Maintain interactive responsiveness with files up to at least 5–20 MB in v1.

### 11.3 Memory
- Avoid duplicating full file contents on each edit.
- Bounded clipboard history with configurable cap.

### 11.4 Crash safety
- Dirty buffer recovery journal (optional v1.1 but strongly recommended).

---

## 12. Cross-Platform Requirements
- Supported: macOS, Linux, Windows.
- Path handling via platform-aware utilities.
- Keyboard normalization layer for OS-specific modifiers.
- Watcher backend compatibility per platform.
- CI matrix must run tests on all 3 OS families.

---

## 13. Observability and Diagnostics
- Built-in debug log levels: `error|warn|info|debug|trace`.
- Optional `--profile-startup` and `--profile-render` outputs.
- Command latency instrumentation (input -> state update -> render).

---

## 14. Testing Strategy

### 14.1 Unit tests
- Piece table operations (insert/delete/replace edge cases)
- Cursor normalization and multi-cursor edits
- Keybinding parser and chord resolver
- Fuzzy scorer ranking stability

### 14.2 Integration tests
- Open/edit/save flows
- External file change conflict handling
- Workspace tree updates from watcher events
- LSP request/response contract tests (mock server)

### 14.3 E2E smoke
- Launch via `npx edit` in CI
- Simulated key input scripts
- Snapshot tests for tree/editor/status rendering

---

## 15. Suggested Implementation Milestones

### M0: Bootstrap
**Goal:** Run `npx edit` and render the first interactive frame with a minimal app shell.

**Deliverables**
- npm package scaffold with `bin` entry and TypeScript build/runtime wiring.
- CLI argument parsing for `edit [paths...]`, `--help`, `--version`.
- App lifecycle boot sequence (`init -> render loop -> shutdown`).
- Renderer skeleton with fixed layout regions (tree/editor/status/palette overlay placeholders).
- Command registry with at least: `app.quit`, `palette.open`, `tree.focus`, `editor.focus`.

**Exit criteria**
- `npx edit` launches a stable TUI frame on macOS/Linux/Windows.
- Unknown flags produce exit code `2` with readable help text.

---

### M1: Core editing
**Goal:** Make single-file editing solid and fast.

**Deliverables**
- Piece-table buffer implementation with insert/delete/replace.
- Cursor + selection model with multi-cursor normalization.
- Undo/redo transactional history with typing coalescing.
- File open/save + dirty state tracking.
- Status line wiring for file name, cursor row/col, dirty marker.

**Exit criteria**
- Open, edit, undo/redo, and save works for text files up to at least 5 MB.
- Median keypress-to-render latency remains interactive during sustained typing.

---

### M2: Workspace UX
**Goal:** Provide reliable project navigation and filesystem sync.

**Deliverables**
- Always-visible collapsible tree with keyboard navigation.
- Multi-root workspace model and rendering.
- Fuzzy file navigation (quick open) backed by indexed paths.
- File watcher integration with debounced refresh.
- External change handling: auto-reload clean files; conflict prompt for dirty files.

**Exit criteria**
- Opening with multiple paths displays unified roots correctly.
- Tree updates reflect create/rename/delete events without restarting.

---

### M3: Power features
**Goal:** Ship productivity features that define day-to-day workflow.

**Deliverables**
- Command palette with fuzzy command matching.
- Chained hotkey resolver (`Ctrl+K` style chords) with context predicates.
- Custom keymap loading + conflict detection warnings.
- Clipboard history ring buffer with configurable size.
- Theme loader/editor + live theme reload on save.

**Exit criteria**
- Users can remap critical editor/tree/palette commands without code changes.
- Palette can execute every registered command.

---

### M4: LSP
**Goal:** Add language intelligence with resilient server lifecycle handling.

**Deliverables**
- LSP client process manager (start, initialize, reconnect, shutdown).
- Incremental text sync and document version tracking.
- Diagnostics surfaced in status line and inline markers.
- Go-to-definition + hover + document symbols commands.
- Timeout/staleness guards for slow or crashed servers.

**Exit criteria**
- At least one mainstream language server (e.g., TypeScript) works end-to-end.
- Server crash/restart path does not freeze editor input.

---

### M5: Hardening
**Goal:** Reach release-quality performance and portability.

**Deliverables**
- Startup and command latency instrumentation (`--profile-startup`, `--profile-render`).
- Performance optimization pass for large files and deep trees.
- Cross-platform key normalization validation (macOS/Linux/Windows modifiers).
- CI matrix with unit, integration, and smoke tests on all supported OS families.
- Release checklist for npm publish, versioning, and rollback plan.

**Exit criteria**
- Cold start and edit responsiveness meet targets in Section 11.
- CI passes green across all supported operating systems.

---

## 16. Acceptance Criteria (v1)
A release is v1-ready when:
- `npx edit` works on macOS/Linux/Windows without manual build steps.
- Single-file editing is smooth with multiple cursors and undo/redo.
- File tree is always visible and supports common navigation actions.
- Auto-save and file-watcher updates are reliable.
- Command palette and customizable/chained keybindings are functional.
- At least one mainstream language has working LSP diagnostics + definition jump.
- Startup and editing meet performance targets on representative hardware.
