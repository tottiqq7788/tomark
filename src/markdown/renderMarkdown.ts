import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Root as HastRoot } from "hast";
import { attachAnchors, buildLineAnchorMap } from "./buildLineAnchorMap";
import { attachSourceRanges } from "./attachSourceRanges";
import { sanitizeSchema } from "./sanitizeSchema";
import type { RenderResult } from "@/shared/types";

export function renderMarkdown(source: string): RenderResult {
  let anchors: ReturnType<typeof attachAnchors> = [];

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(() => (tree: HastRoot) => {
      anchors = attachAnchors(tree);
      attachSourceRanges(tree);
    })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

  const file = processor.processSync(source);
  const html = String(file);
  const lineToAnchor = buildLineAnchorMap(source, anchors);

  return { html, lineToAnchor, anchors };
}
