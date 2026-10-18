import { Marked } from "marked";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

// The full grammar bundle is ~1 MB. These cover the languages that actually appear in agent output.
for (const [name, grammar] of Object.entries({
  bash,
  css,
  diff,
  javascript,
  json,
  markdown,
  python,
  rust,
  typescript,
  xml,
})) {
  hljs.registerLanguage(name, grammar);
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (raw: string): string =>
  raw.replace(/[&<>"']/g, (char) => ESCAPES[char]);

// A scheme or a protocol-relative "//host" means the URL already carries its own authority.
const HAS_AUTHORITY = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const SCRIPT_PROTOCOL = /^(?:javascript|vbscript):/i;
// A Windows drive path matches HAS_AUTHORITY as if "C" were a scheme, but it still has to be
// handed to resolveUrl: the webview serves from the asset protocol and cannot read it raw.
const WINDOWS_DRIVE = /^[a-z]:[\\/]/i;

export type ResolveUrl = (relativePath: string) => string;

export interface RenderOptions {
  resolveUrl?: ResolveUrl;
}

function resolveHref(href: string, resolveUrl?: ResolveUrl): string {
  if (!resolveUrl || !href) return href;
  const url = href.trim();
  if (url === "" || url.startsWith("#")) return href;
  if (WINDOWS_DRIVE.test(url) || !HAS_AUTHORITY.test(url)) return resolveUrl(url);
  return href;
}

const safeHref = (href: string): string =>
  SCRIPT_PROTOCOL.test(href.trim()) ? "" : href;

export function render(markdown: string, opts: RenderOptions = {}): string {
  const { resolveUrl } = opts;

  const marked = new Marked({ gfm: true });

  marked.use({
    renderer: {
      // Transcripts echo untrusted file content, so raw HTML is shown, never executed.
      html(token) {
        return escapeHtml(token.raw);
      },
      code({ text, lang }) {
        const language = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
        const grammar = language ? hljs.getLanguage(language) : undefined;
        const body = grammar
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : escapeHtml(text);
        const cls = grammar ? ` class="language-${escapeHtml(language)}"` : "";
        return `<pre><code${cls}>${body}</code></pre>\n`;
      },
      link(token) {
        const body = this.parser.parseInline(token.tokens);
        const href = escapeHtml(safeHref(resolveHref(token.href, resolveUrl)));
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${href}"${title}>${body}</a>`;
      },
      image(token) {
        // No protocol guard: an img src never executes, and data: is legitimate inline art.
        const src = escapeHtml(resolveHref(token.href, resolveUrl));
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<img src="${src}" alt="${escapeHtml(token.text)}"${title}>`;
      },
    },
  });

  return marked.parse(markdown, { async: false }) as string;
}