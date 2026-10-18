import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "./md";

const SOURCE = readFileSync(fileURLToPath(new URL("./md.ts", import.meta.url)), "utf8");
const identity = (rel: string) => `resolved:${rel}`;

describe("purity", () => {
  it("touches no browser or Tauri global", () => {
    expect(SOURCE).not.toMatch(/\bdocument\b/);
    expect(SOURCE).not.toMatch(/\bwindow\b/);
    expect(SOURCE).not.toMatch(/@tauri-apps/);
  });
});

describe("relative url resolution", () => {
  it("routes relative image and link sources through resolveUrl", () => {
    const html = render("![x](diagram.png)\n\n[n](notes.md)", { resolveUrl: identity });
    expect(html).toContain('src="resolved:diagram.png"');
    expect(html).toContain('href="resolved:notes.md"');
  });

  it("routes a windows drive path through resolveUrl", () => {
    const html = render("![x](C:/Users/me/pic.png)", { resolveUrl: identity });
    expect(html).toContain('src="resolved:C:/Users/me/pic.png"');
  });

  it("leaves absolute and in-document urls untouched", () => {
    const html = render(
      "[a](https://e.com/x?b=1&c=2) [b](//host/x) [c](mailto:s@e.com) [d](#top) [e](data:text/plain,hi)",
      { resolveUrl: identity },
    );
    expect(html).toContain('href="https://e.com/x?b=1&amp;c=2"');
    expect(html).toContain('href="//host/x"');
    expect(html).toContain('href="mailto:s@e.com"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('href="data:text/plain,hi"');
    expect(html).not.toContain("resolved:");
  });

  it("returns input unchanged when no resolver is supplied", () => {
    expect(render("![x](diagram.png)")).toContain('src="diagram.png"');
  });
});

describe("raw html is escaped, never rendered", () => {
  it("escapes inline and block html", () => {
    const html = render("<script>alert(1)</script>\n\n<div onclick=x>hi</div>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<div");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;div onclick=x&gt;");
  });

  it("drops javascript and vbscript link protocols", () => {
    const html = render("[l](javascript:alert(1)) [v](vbscript:msgbox) [j](JavaScript:alert(1))");
    expect(html).not.toMatch(/href="(javascript|vbscript|JavaScript)/i);
    expect(html.match(/href=""/g)).toHaveLength(3);
  });

  it("escapes title and alt attribute injection", () => {
    const html = render('![a](x.png "ti\\"tle")');
    expect(html).not.toMatch(/ti"tle/);
    expect(html).toContain("&quot;");
  });

  it("survives a hostile resolver returning a quote breakout", () => {
    const html = render("[x](a.md)", { resolveUrl: () => '" onmouseover="alert(1)' });
    expect(html).not.toContain('onmouseover="alert(1)"');
  });
});

describe("code fences", () => {
  it("highlights a registered language", () => {
    const html = render("```rust\nfn main() {}\n```");
    expect(html).toContain('class="language-rust"');
    expect(html).toContain("hljs-keyword");
  });

  it("falls back to escaped plain text for an unknown language", () => {
    const html = render("```nosuchlang\n<script>x\n```");
    expect(html).toContain("<pre><code");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes code with no language", () => {
    expect(render("```\n<b>&\n```")).toContain("&lt;b&gt;&amp;");
  });

  it("does not throw on an unparseable body in a known language", () => {
    expect(() => render("```python\ndef (:\n```")).not.toThrow();
  });

  it("renders inline code and other defaults", () => {
    const html = render("some `inline`\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<code>inline</code>");
    expect(html).toContain("<table>");
  });
});