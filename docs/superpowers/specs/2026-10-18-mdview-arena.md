# Arena synthesis — render pipeline

Two candidates designed the TypeScript render pipeline for `mdview` (`src/md.ts`,
`src/jsonl.ts`) against `2026-10-18-mdview-design.md`. A readonly cross-judge scored them
on a five-criterion rubric by executing both in-process against marked 18.0.5 and
highlight.js 11.12.0, not by reading alone.

## Base: candidate 1

It wins the only hard requirement and pays nothing for the win. Candidate 2's two serious
defects are structural rather than patchable:

- Its `link` override has no protocol floor. marked 18 does no `javascript:` filtering of its
  own, so `[x](javascript:alert(1))` renders as a live link in a page holding
  `__TAURI_INTERNALS__`.
- Its part filtering drops `thinking` and `redacted_thinking` whenever a text sibling exists.
  `thinking` is normal content in a Claude Code assistant message, so its fallback, which only
  fires when nothing was recognised, never fires on the primary data path.

Candidate 1's own blemishes are one-line fixes.

## Cross-judge verdict

Base on candidate 1, with three grafts. The judge disagreed with two of my own initial
suspicions and retracted them after checking: `new Marked({ renderer })` does not drop the
prototype renderers, and the `html` override cannot throw on an inline tag token because both
token types declare `raw` non-optionally.

It also caught one defect I had missed in my own first pass, the silently dropped `thinking`
part, and two that apply to both candidates: a Windows drive path such as `C:/Users/me/pic.png`
matches the URI-scheme regex, so both skipped resolution and would 404 on the asset origin;
and both emit assistant prose unfenced, so a stray fence in transcript text can forge
headings and tables.

## Grafts taken from candidate 2

1. Capture `resolveUrl` in a closure instead of reading `this.parser.options`. The internal
   marked surface breaks silently, not at compile time as candidate 1's notes claimed.
2. Register the `markdown` grammar. It is the most common fence in a transcript and
   candidate 1 registered `diff` instead. Both are registered in the merge.
3. Label a parsed-but-unmodelled record type distinctly from an unparseable line, and stop
   collapsing a file of unknown types into one raw dump.

## Rejected from candidate 2

Its dead `escaped` branch in the code renderer, its per-call `new Renderer()` that marked
discards, and its line handlers wholesale, which are the shape that drops `thinking`.

## Fixed for both

Windows drive paths route through `resolveUrl` ahead of the scheme check.

## Verification

`npx vitest run src/md.test.ts src/jsonl.test.ts` gives 28 passing across 2 files. The suite
covers all five rubric criteria, including the two defects that decided the arena: a
`javascript:` href is dropped to `href=""`, and a `thinking` part survives next to a text
sibling.

One test was wrong on first run and the code was right. An assertion that the output does not
contain the string `onclick=x` failed against `&lt;div onclick=x&gt;`, where the attribute is
already inert escaped text. It now asserts no element from the source survives as a tag.

## Known limits carried forward

Assistant prose is still unfenced. A ` ``` ` inside transcript text can restructure the rest
of the document. Not a script-execution risk, since `md.ts` escapes all HTML, but it lets
transcript content forge headings and tables. Fencing assistant prose would fix it.