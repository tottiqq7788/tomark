import { unified } from "unified";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Root as HastRoot } from "hast";
import { attachAnchors, buildLineAnchorMap } from "./buildLineAnchorMap";
import { attachSourceRanges } from "./attachSourceRanges";
import { sanitizeSchema } from "./sanitizeSchema";
import {
  parseMarkdownDocument,
  type ParsedMarkdownDocument,
} from "./parseMarkdownDocument";
import type { RenderResult } from "@/shared/types";

export function renderMarkdown(
  input: string | ParsedMarkdownDocument,
): RenderResult {
  const parsed =
    typeof input === "string" ? parseMarkdownDocument(input) : input;
  const source = parsed.source;
  let anchors: ReturnType<typeof attachAnchors> = [];

  const processor = unified()
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(() => (tree: HastRoot) => {
      anchors = attachAnchors(tree);
      attachSourceRanges(tree);
    })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

  const tree = processor.runSync(parsed.tree);
  const html = String(processor.stringify(tree));
  const lineToAnchor = buildLineAnchorMap(source, anchors);

  return { html, lineToAnchor, anchors };
}
