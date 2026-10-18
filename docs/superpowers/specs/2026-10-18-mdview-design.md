# mdview — design

Markdown viewer for Windows, driven by local CLI agents.

## Goal

Read markdown nicely, and let a CLI agent (Claude Code and friends) put a file on screen
by running `mdview <path>` from a shell. Plain `.md` is the main use case; Claude Code
`.jsonl` transcripts render as a readable conversation/timeline.

## Stack

- Tauri 2 (Rust shell) + TypeScript + Vite. Vanilla DOM, no UI framework.
- `marked` for markdown → HTML, `highlight.js` for fenced code blocks.
- Plugins: `tauri-plugin-single-instance`, `tauri-plugin-dialog`, `tauri-plugin-fs`,
  `tauri-plugin-notify` (file watching), `tauri-plugin-opener`.

## Architecture

| Unit | Where | Responsibility |
|---|---|---|
| `src-tauri/src/main.rs` | Rust | Entry; registers plugins |
| `src-tauri/src/lib.rs` | Rust | `open_path` command (read file → return text + kind); watch registration; `file-changed` event emit |
| `src/md.ts` | TS | markdown → HTML. Escapes raw HTML. Highlights fenced code. |
| `src/jsonl.ts` | TS | Claude Code transcript `.jsonl` → markdown string |
| `src/app.ts` | TS | State (current path, source, theme). Wires dialog, drag-drop, watcher events, theme toggle. |
| `src/styles.css` | CSS | Layout + light/dark via `[data-theme]` on `<html>` |

### Boundaries

- Rust never parses markdown or jsonl. It reads bytes and reports changes.
- `md.ts` is pure: `(string) -> string`. No DOM, no Tauri. Directly unit-testable.
- `jsonl.ts` is pure: `(string) -> string` (markdown). Feeds `md.ts`.
- `app.ts` is the only module that knows about Tauri APIs.

## Data flow

```
agent Bash -> `mdview path.md`
  window not running -> cold start, argv read at startup, open path
  window running     -> tauri-plugin-single-instance forwards argv to live window,
                        window focuses and opens path

file changed on disk -> notify watcher -> emit "file-changed"
  -> app.ts re-reads via open_path -> re-render

user drops file on window / Open button
  -> native dialog or drop event -> same open_path path
  -> .jsonl converted by jsonl.ts first, then rendered by md.ts
```

`open_path` returns `{ path, kind: "markdown" | "transcript", text }`. `kind` is decided
by extension: `.jsonl` → transcript, everything else → markdown.

## Rendering rules

- Raw HTML in the markdown source is **escaped, not rendered**. Agent transcripts
  routinely echo untrusted file content; a webview that executes it is an RCE footgun.
  Zero extra dependency, so no sanitizer library.
- Fenced code blocks get `highlight.js` with a small common-language set.
- Non-highlighted languages fall back to plain `<pre><code>`.

## Transcript transform

Each `.jsonl` line is a JSON object. Per line:

- `type == "user"` → `## User` + fenced block of `message.content` (string) or the
  flattened text of content parts; tool-result parts render as a nested
  `### Tool result` fenced block.
- `type == "assistant"` → `## Assistant` + text parts inline, then one
  `### Tool: <name>` fenced block per `tool_use` part with its `input` as JSON.
- `type == "summary"` → `## Summary` + `summary` field.
- Unparseable line → `# Unparsed line N` + raw line in a fenced block, so nothing is
  silently dropped.
- Whole-file JSON parse failure → fall back to rendering the raw text as a single
  fenced block.

## Error handling

- File read failure → inline error panel with path and OS error. Previous document stays
  on screen until a successful load replaces it.
- Unreadable/invalid UTF-8 → lossy decode (`String::from_utf8_lossy` equivalent), still render.
- Watcher path errors are non-fatal: log and drop the watch.
- Non-`.md`/`.jsonl` files opened anyway are treated as markdown if UTF-8 decodable.

## Theming

`<html data-theme="dark|light">`. Defaults to `prefers-color-scheme`. Toggle button
persists choice to `localStorage` (`mdview.theme`).

## Testing

- `vitest` for `md.ts`: raw-HTML escaping, fenced code → highlighted `<pre><code>`,
  heading levels, malformed fence.
- `vitest` for `jsonl.ts`: user/assistant/summary mapping, tool_use block, malformed
  line fallback, non-JSONL input fallback.
- No Rust tests. Rust commands are thin fs wrappers with one error path each.

## Non-goals (v1)

In-page find, recent-files sidebar, editing/saving, tabs, PDF/HTML export,
transcripts from agents other than Claude Code (unknown JSONL shapes fall back to
raw dump).

Relative-path images (`![](diagram.png)`) will not load: the webview is served from
the Tauri asset protocol, not the file's directory. Serving the document's own folder
via `convertFileSrc` is the upgrade if this matters.

## Known limits

- `highlight.js` bundled grammars add roughly 1 MB to a ~5 MB binary. Trim to core
  languages if size becomes a problem.
- Single-instance argv forwarding is the only integration point. Agents that cannot
  spawn a process have no way in; a localhost HTTP endpoint would be the upgrade.