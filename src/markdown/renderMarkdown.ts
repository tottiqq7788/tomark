import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import type { Root as HastRoot } from "hast";
import { attachAnchors, buildLineAnchorMap } from "./buildLineAnchorMap";
import { sanitizeSchema } from "./sanitizeSchema";
import type { RenderResult } from "@/shared/types";

export type RenderMarkdownMode = "preview" | "export";

export function renderMarkdown(
  source: string,
  options?: { mode?: RenderMarkdownMode },
): RenderResult {
  const mode = options?.mode ?? "preview";
  let anchors: ReturnType<typeof attachAnchors> = [];

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(() => (tree: HastRoot) => {
      if (mode === "preview") {
        anchors = attachAnchors(tree);
      }
    })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

  const file = processor.processSync(source);
  const html = String(file);
  const lineToAnchor =
    mode === "preview"
      ? buildLineAnchorMap(source, anchors)
      : new Map();

  return { html, lineToAnchor, anchors };
}
