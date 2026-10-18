# mdview

A Windows desktop markdown viewer that a CLI agent can open a file in.

An agent runs `mdview notes.md` from its shell. The window comes up with that
document already rendered. Run it again and the existing window takes focus and
swaps the document instead of opening a second one.

```
mdview README.md
mdview C:\Users\me\.claude\projects\foo\9a74ae7a.jsonl
mdview              # opens the dialog
```

Plain `.md` is the main use case. Claude Code `.jsonl` session transcripts are
supported too, rendered as a readable conversation timeline rather than a wall
of JSON.

## What it does

- Opens files from a CLI argument, a native file dialog, or drag and drop.
- Syntax-highlighted fenced code blocks, 10 common languages.
- Live reload. Save the file in your editor and the view updates itself.
- Light and dark themes, following the system setting by default.
- Relative links between markdown files navigate inside the app.
- Relative images resolve against the document's directory.

## Install

Requires Rust, Node `^20.19` or `>=22.12` (Vite 8's engine requirement), and the
[Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for Windows.

```sh
git clone https://github.com/aswathas/mdview
cd mdview
npm install
npm run tauri dev
```

For the binary:

```sh
npm run tauri build
```

The executable lands at `src-tauri/target/release/mdview.exe`. Put that folder
on your `PATH` so agents can spawn it. A second `mdview <file>` while it is
running hands the path to the running instance and exits immediately.

## Commands

| Command | Description |
|---|---|
| `npm run tauri dev` | Run the app with hot reload |
| `npm run tauri build` | Produce a release bundle |
| `npm test` | Run the unit tests (vitest) |
| `npm run build` | Typecheck and build the frontend |
| `mdview <path>` | Open a document in the running or a new window |

## Wiring it to an agent

The integration point is one line in the agent's instructions. In `CLAUDE.md`:

```markdown
When a file's contents are worth showing me, run `mdview <path>`.
```

That is the whole contract. No hooks, no daemon, no server.

## Architecture

| Module | Responsibility |
|---|---|
| `src-tauri/src/lib.rs` | Reads files, registers the watcher, forwards argv from second instances |
| `src/md.ts` | Markdown to HTML. Pure, no DOM, no Tauri import |
| `src/jsonl.ts` | Claude Code transcript to markdown. Pure |
| `src/app.ts` | The only module that touches Tauri APIs |
| `src/styles.css` | Layout and theming via `[data-theme]` on `<html>` |

Rust never parses markdown. The two TypeScript modules that do are pure
string-to-string functions, which is why the test suite runs in a millisecond
with no browser and no Tauri runtime.

`docs/superpowers/specs/2026-10-18-mdview-design.md` is the design of record,
including the reasoning behind each of these choices.

## Security

Two deliberate choices, both worth knowing before you run it.

**Raw HTML in markdown is escaped, not rendered.** Agent transcripts routinely
echo untrusted file contents, and a webview that executes that is a remote code
execution footgun. `<script>` in a document displays as text.

**The asset protocol scope is unrestricted.** Relative images and links are
resolved to absolute paths and handed to the webview with no directory jail, so
a document can name any path the current user can read. This is acceptable for a
viewer you open your own files in. If you plan to open transcripts from sources
you do not trust, do not, until the resolver rejects paths outside the
document's own tree.

## Build notes

The Rust library is built as `crate-type = ["rlib"]`. The `cdylib` and
`staticlib` outputs are mobile-target requirements, and the MinGW linker
rejects this crate's export table on Windows with "export ordinal too large".

`.rsrc merge failure: multiple non-default manifests` during linking is a known
MinGW toolchain warning, not a build failure.

## Limitations

- No find-in-page, no recent files list, no editing, no tabs, no export.
- Only Claude Code transcripts are modelled. Other agents' JSONL falls back to
  a raw dump. Unknown record types inside a Claude Code transcript render as
  labelled `Unknown entry` blocks rather than being dropped, so new formats
  stay visible.
- Single-instance argv forwarding is the only integration. An agent that cannot
  spawn a process has no way in.