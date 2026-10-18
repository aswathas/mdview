import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transcriptToMarkdown } from "./jsonl";

const SOURCE = readFileSync(fileURLToPath(new URL("./jsonl.ts", import.meta.url)), "utf8");
const line = (value: unknown) => JSON.stringify(value);

describe("purity", () => {
  it("touches no browser or Tauri global", () => {
    expect(SOURCE).not.toMatch(/\bdocument\b/);
    expect(SOURCE).not.toMatch(/\bwindow\b/);
    expect(SOURCE).not.toMatch(/@tauri-apps/);
  });
});

describe("known entry types", () => {
  it("renders a user message", () => {
    const md = transcriptToMarkdown(line({ type: "user", message: { content: "hello" } }));
    expect(md).toContain("## User");
    expect(md).toContain("hello");
  });

  it("renders assistant prose and one block per tool call", () => {
    const md = transcriptToMarkdown(
      line({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "let me look" },
            { type: "tool_use", name: "Read", input: { file_path: "a.md" } },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
    );
    expect(md).toContain("## Assistant");
    expect(md).toContain("let me look");
    expect(md).toContain("### Tool: Read");
    expect(md).toContain("### Tool: Bash");
    expect(md).toContain('```json');
    expect(md).toContain("file_path");
  });

  it("renders a summary", () => {
    expect(transcriptToMarkdown(line({ type: "summary", summary: "did a thing" }))).toContain(
      "## Summary",
    );
  });

  it("numbers lines across CRLF and a trailing newline", () => {
    const md = transcriptToMarkdown(
      `${line({ type: "user", message: { content: "a" } })}\r\nnot json\r\n`,
    );
    expect(md).toContain("## User");
    expect(md).toContain("# Unparsed line 2");
  });
});

describe("nothing is dropped silently", () => {
  it("keeps a thinking part alongside a text sibling", () => {
    const md = transcriptToMarkdown(
      line({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "SECRET" },
            { type: "text", text: "answer" },
          ],
        },
      }),
    );
    expect(md).toContain("### thinking");
    expect(md).toContain("SECRET");
    expect(md).toContain("answer");
  });

  it("keeps an unmodelled part on a user message", () => {
    const md = transcriptToMarkdown(
      line({
        type: "user",
        message: { content: [{ type: "image", source: { data: "..." } }] },
      }),
    );
    expect(md).toContain("### image");
  });

  it("labels a parsed record of an unmodelled type as unknown, not unparsed", () => {
    const md = transcriptToMarkdown(line({ type: "system", subtype: "init" }));
    expect(md).toContain("## Unknown entry (type: system) — line 1");
    expect(md).not.toContain("# Unparsed line");
  });

  it("keeps per-line structure for a file of only unknown types", () => {
    const md = transcriptToMarkdown(
      `${line({ type: "system" })}\n${line({ type: "system" })}`,
    );
    expect(md).toContain("— line 1");
    expect(md).toContain("— line 2");
  });

  it("shows a non-object json line", () => {
    const md = transcriptToMarkdown(`"just a string"\n42`);
    expect(md).toContain("## Unknown entry");
    expect(md).toContain("just a string");
  });

  it("renders a tool call with no input as null rather than empty", () => {
    const md = transcriptToMarkdown(
      line({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read" }] },
      }),
    );
    expect(md).toContain("### Tool: Read");
    expect(md).toContain("null");
  });
});

describe("fallbacks", () => {
  it("dumps a file that is not jsonl as one block", () => {
    const md = transcriptToMarkdown("just some prose\nsecond line");
    expect(md).toContain("```");
    expect(md).toContain("just some prose");
    expect(md).not.toContain("# Unparsed line");
  });

  it("returns empty for empty input", () => {
    expect(transcriptToMarkdown("")).toBe("");
    expect(transcriptToMarkdown("   \n  ")).toBe("");
  });

  it("widens the fence so transcript backticks cannot break out", () => {
    const md = transcriptToMarkdown(line({ type: "user", message: { content: "a ``` b" } }));
    expect(md).toContain("````");
  });
});

describe("session bookkeeping", () => {
  it("drops metadata records instead of rendering them as entries", () => {
    const md = transcriptToMarkdown(
      [
        line({ type: "mode", mode: "normal" }),
        line({ type: "file-history-snapshot", isSnapshotUpdate: false }),
        line({ type: "attachment", attachment: { type: "hook_success", stdout: "ok" } }),
        line({ type: "last-prompt" }),
        line({ type: "queue-operation" }),
        line({ type: "atis-latch" }),
        line({ type: "user", message: { content: "hello" } }),
      ].join("\n"),
    );
    expect(md).toContain("hello");
    expect(md).not.toContain("Unknown entry");
    expect(md.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(1);
  });

  it("still labels a genuinely unmodelled type", () => {
    const md = transcriptToMarkdown(line({ type: "brand_new_thing", data: 1 }));
    expect(md).toContain("Unknown entry (type: brand_new_thing)");
  });
});