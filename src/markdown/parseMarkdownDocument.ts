import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export type MarkdownLineEnding = "\n" | "\r\n";

export interface ParsedMarkdownDocument {
  /** The exact application source. Offsets in `tree` refer to this string. */
  readonly source: string;
  readonly tree: Root;
  /** Dominant newline used by structure commands for newly inserted lines. */
  readonly lineEnding: MarkdownLineEnding;
}

const markdownParser = unified().use(remarkParse).use(remarkGfm).freeze();

export function detectMarkdownLineEnding(source: string): MarkdownLineEnding {
  const firstLf = source.indexOf("\n");
  return firstLf > 0 && source[firstLf - 1] === "\r" ? "\r\n" : "\n";
}

/**
 * Parse Markdown once while retaining mdast UTF-16 offsets.
 *
 * Consumers must keep `source` and `tree` together. Reusing a tree with a
 * different source would invalidate every projection/source-map invariant.
 */
export function parseMarkdownDocument(source: string): ParsedMarkdownDocument {
  return {
    source,
    tree: markdownParser.parse(source),
    lineEnding: detectMarkdownLineEnding(source),
  };
}
