import type { ProjectionTextContext } from "@/markdown/buildEditableProjection";

export interface MarkdownTextEscapeOptions {
  readonly context?: ProjectionTextContext;
  /** Whether the insertion point is at the start of a Markdown source line. */
  readonly atLineStart?: boolean;
  /** Visible character immediately before/after the inserted text. */
  readonly before?: string;
  readonly after?: string;
}

const ALWAYS_ESCAPED = new Set(["\\", "`", "*", "_", "[", "]", "<", "&"]);

function charBefore(
  text: string,
  index: number,
  options: MarkdownTextEscapeOptions,
): string {
  return index > 0 ? text[index - 1]! : (options.before ?? "");
}

function charAfter(
  text: string,
  index: number,
  options: MarkdownTextEscapeOptions,
): string {
  return index + 1 < text.length ? text[index + 1]! : (options.after ?? "");
}

function startsMarkdownBlock(
  text: string,
  index: number,
  char: string,
  options: MarkdownTextEscapeOptions,
): boolean {
  const previousNewline = text.lastIndexOf("\n", index - 1);
  const prefix = text.slice(previousNewline + 1, index);
  const beginsAtSourceLine =
    previousNewline >= 0 || (options.atLineStart ?? false);
  if (!beginsAtSourceLine) {
    return false;
  }
  const next = charAfter(text, index, options);
  const lineRemainder = text.slice(index).split(/\r?\n/, 1)[0] ?? "";
  if (
    prefix === "" &&
    ((char === "-" && /^-{3,}[ \t]*$/.test(lineRemainder)) ||
      (char === "=" && /^=+[ \t]*$/.test(lineRemainder)))
  ) {
    return true;
  }
  if (
    prefix === "" &&
    (char === "#" || char === ">" || char === "-" || char === "+") &&
    /\s/.test(next)
  ) {
    return true;
  }
  if (char !== "." && char !== ")") {
    return false;
  }
  return /^\d{1,9}$/.test(prefix) && /\s/.test(next);
}

/**
 * Escape user-entered plain text without touching any existing Markdown.
 *
 * This is intentionally context-aware rather than a Markdown serializer.
 */
export function escapeMarkdownText(
  text: string,
  options: MarkdownTextEscapeOptions = {},
): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const before = charBefore(text, index, options);
    const after = charAfter(text, index, options);
    const escape =
      ALWAYS_ESCAPED.has(char) ||
      (char === "|" && options.context === "table-cell") ||
      (char === "!" && after === "[") ||
      (char === "~" && (before === "~" || after === "~")) ||
      startsMarkdownBlock(text, index, char, options);
    result += escape ? `\\${char}` : char;
  }
  return result;
}

