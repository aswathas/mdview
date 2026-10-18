interface Part {
  type?: string;
  text?: string;
  content?: unknown;
  name?: string;
  input?: unknown;
}

interface TranscriptRecord {
  type?: unknown;
  summary?: unknown;
  message?: { content?: string | Part[] };
}

// A transcript line can contain its own backtick runs; a fixed fence would let it break out.
function fenceFor(text: string): string {
  const longest = (text.match(/`{3,}/g) ?? []).reduce(
    (n, run) => Math.max(n, run.length),
    0,
  );
  return "`".repeat(Math.max(3, longest + 1));
}

function fenced(text: string, lang = ""): string {
  const fence = fenceFor(text);
  return `${fence}${lang}\n${text}\n${fence}`;
}

function asParts(content: string | Part[] | undefined): Part[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function dump(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2) ?? "null";
}

// Whatever a content part turns out to be, it stays on the page instead of vanishing.
function unknownPart(part: Part): string {
  return `### ${part.type ?? "unknown part"}\n\n${fenced(dump(part))}`;
}

function userBody(content: string | Part[] | undefined): string {
  const parts = asParts(content);
  if (parts.length === 0) return "";
  return parts
    .map((part) =>
      part.type === "tool_result"
        ? `### Tool result\n\n${fenced(dump(part.content))}`
        : part.type === "text"
          ? fenced(part.text ?? "")
          : unknownPart(part),
    )
    .join("\n\n");
}

function assistantBody(content: string | Part[] | undefined): string {
  const parts = asParts(content);
  const blocks: string[] = [];
  const prose = parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text as string)
    .join("\n\n");
  if (prose) blocks.push(prose);
  for (const part of parts.filter((p) => p.type === "tool_use")) {
    blocks.push(`### Tool: ${part.name ?? "unknown"}\n\n${fenced(dump(part.input), "json")}`);
  }
  for (const part of parts.filter((p) => p.type !== "text" && p.type !== "tool_use")) {
    blocks.push(unknownPart(part));
  }
  return blocks.join("\n\n");
}

function toMarkdown(record: unknown): string | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const { type, summary, message } = record as TranscriptRecord;
  switch (type) {
    case "user":
      return `## User\n\n${userBody(message?.content)}`.trimEnd();
    case "assistant":
      return `## Assistant\n\n${assistantBody(message?.content)}`.trimEnd();
    case "summary":
      return typeof summary === "string" ? `## Summary\n\n${summary}` : null;
    default:
      return null;
  }
}

// A line that parsed but names a type we do not model is not "unparsed". Say which it was.
function unknownRecord(lineNumber: number, raw: string): string {
  let type = "unknown";
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    if (typeof parsed.type === "string") type = parsed.type;
  } catch {
    // fall through to the generic label
  }
  return `## Unknown entry (type: ${type}) — line ${lineNumber}\n\n${fenced(raw)}`;
}

function unparsed(lineNumber: number, raw: string): string {
  return `# Unparsed line ${lineNumber}\n\n${fenced(raw)}`;
}

export function transcriptToMarkdown(jsonlText: string): string {
  if (!jsonlText.trim()) return "";

  const blocks: string[] = [];
  let parsedCount = 0;

  for (const [index, raw] of jsonlText.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      blocks.push(unparsed(index + 1, raw));
      continue;
    }
    parsedCount += 1;
    const block = toMarkdown(parsed);
    blocks.push(
      block === null ? unknownRecord(index + 1, raw) : block,
    );
  }

  // Not one line parsed as JSON: this was never a transcript, so show it verbatim
  // rather than burying the reader in a heading per line.
  return parsedCount === 0 ? fenced(jsonlText) : blocks.join("\n\n");
}