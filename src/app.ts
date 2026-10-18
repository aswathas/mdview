import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { watch, type UnwatchFn, type WatchEventKind } from "@tauri-apps/plugin-fs";
import { render } from "./md";
import { transcriptToMarkdown } from "./jsonl";

type DocKind = "markdown" | "transcript";

type Doc =
  | { state: "empty" }
  | { state: "loaded"; path: string; kind: DocKind; text: string }
  | { state: "error"; path: string; message: string };

interface LoadedDoc {
  path: string;
  kind: DocKind;
  text: string;
}

type Action =
  | { type: "loaded"; doc: LoadedDoc }
  | { type: "failed"; path: string; message: string };

const OPEN_PATH_EVENT = "mdview://open-path";
const THEME_KEY = "mdview.theme";
const DOC_EXT = /\.(?:md|markdown|jsonl)$/i;
const ABSOLUTE = /^[a-z]:[\\/]/i;

let doc: Doc = { state: "empty" };
/** Banner message shown above a still-visible document; null when there is nothing to say. */
let notice: string | null = null;

/** Absolute path behind each URL we handed to `resolveUrl`, so clicks resolve back exactly. */
const resolvedUrls = new Map<string, string>();

let unwatch: UnwatchFn | null = null;

function reduce(action: Action): void {
  switch (action.type) {
    case "loaded":
      doc = { state: "loaded", ...action.doc };
      notice = null;
      return;
    case "failed":
      // A failed reload must not discard what the user is reading.
      if (doc.state === "loaded") notice = action.message;
      else doc = { state: "error", path: action.path, message: action.message };
      return;
  }
}

function directoryOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return cut === -1 ? "" : path.slice(0, cut);
}

/** Resolve `rel` against the document's own directory, without pulling in a path library. */
function resolveAgainst(baseDir: string, rel: string): string {
  if (ABSOLUTE.test(rel)) return rel;
  let decoded = rel;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    // A malformed escape is not worth failing the render over; the raw text is still a path.
  }

  const unc = baseDir.startsWith("\\\\");
  const parts = baseDir.split(/[\\/]+/).filter(Boolean);
  for (const segment of decoded.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return (unc ? "\\\\" : "") + parts.join("\\");
}

const contentEl = () => document.querySelector<HTMLElement>("#content")!;
const bannerEl = () => document.querySelector<HTMLElement>("#notice")!;

function paint(): void {
  const el = contentEl();
  const banner = bannerEl();

  if (notice !== null) {
    banner.textContent = notice;
    banner.hidden = false;
  } else {
    banner.textContent = "";
    banner.hidden = true;
  }

  if (doc.state === "empty") {
    el.innerHTML = "";
    el.textContent = "Drop a file here, or press Open.";
    document.title = "mdview";
    return;
  }

  if (doc.state === "error") {
    el.innerHTML = "";
    el.textContent = `Could not open ${doc.path}\n${doc.message}`;
    document.title = `${doc.path} — mdview`;
    return;
  }

  resolvedUrls.clear();
  const { path, kind, text } = doc;
  const source = kind === "transcript" ? transcriptToMarkdown(text) : text;

  el.innerHTML = render(source, {
    resolveUrl: (rel) => {
      const absolute = resolveAgainst(directoryOf(path), rel);
      const url = convertFileSrc(absolute);
      resolvedUrls.set(url, absolute);
      return url;
    },
  });
  document.title = `${doc.path} — mdview`;
}

async function load(path: string): Promise<void> {
  try {
    const loaded = await invoke<LoadedDoc>("open_path", { path });
    reduce({ type: "loaded", doc: loaded });
  } catch (err) {
    reduce({ type: "failed", path, message: String(err) });
  }
  paint();
}

/**
 * Reading the document fires an access event, so honouring those would make each reload
 * schedule the next one forever.
 */
function isRead(kind: WatchEventKind): boolean {
  return typeof kind === "object" && "access" in kind;
}

async function show(path: string): Promise<void> {
  await load(path);
  if (doc.state !== "loaded") return;

  unwatch?.();
  unwatch = null;
  try {
    unwatch = await watch(path, (event) => {
      if (!isRead(event.type)) void load(path);
    });
  } catch (err) {
    // Watching is a convenience; the document is already on screen and stays usable.
    console.warn(`mdview: not watching ${path}`, err);
  }
}

function applyTheme(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
}

function currentTheme(): "light" | "dark" {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function wireControls(): void {
  document.querySelector("#open-button")!.addEventListener("click", async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Documents", extensions: ["md", "markdown", "jsonl", "txt"] }],
    });
    if (typeof picked === "string") void show(picked);
  });

  document.querySelector("#theme-button")!.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

function wireLinks(): void {
  contentEl().addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href");
    if (!anchor || href === null || href === undefined) return;
    // render leaves fragments alone, so the browser's own jump is the correct behaviour.
    if (href.startsWith("#")) return;
    event.preventDefault();

    const local = resolvedUrls.get(href);
    if (local && DOC_EXT.test(local)) {
      void show(local);
      return;
    }
    if (/^https?:/i.test(href)) void openUrl(href);
  });
}

export async function boot(): Promise<void> {
  applyTheme(currentTheme());
  wireControls();
  wireLinks();

  void getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") return;
    const [path] = event.payload.paths;
    if (path) void show(path);
  });

  await listen<string>(OPEN_PATH_EVENT, (event) => void show(event.payload));
  paint();

  const coldStart = await invoke<string | null>("startup_path");
  if (coldStart) void show(coldStart);
}