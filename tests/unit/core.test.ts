import { describe, expect, it } from "vitest";
import {
  buildHeadingTree,
  extractHeadings,
  flattenHeadingTree,
  isPathPrefix,
  pathKey,
} from "@/editor/headingTree";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import { buildLineAnchorMap } from "@/markdown/buildLineAnchorMap";
import { detectFormat, serializeContent } from "@/native/fileService";
import type { PreviewAnchor } from "@/shared/types";

const SAMPLE = `# One

Intro

## Two

Body two

### Three

Deep

## Four

Tail
`;

describe("headingTree", () => {
  it("builds nested heading paths and body ranges", () => {
    const roots = buildHeadingTree(SAMPLE);
    expect(roots).toHaveLength(1);
    expect(roots[0].text).toBe("One");
    expect(roots[0].children.map((c) => c.text)).toEqual(["Two", "Four"]);
    expect(roots[0].children[0].children[0].text).toBe("Three");
    expect(pathKey(roots[0].children[0].path)).toBe("0.0");
  });

  it("compares path prefixes by array, not string startsWith", () => {
    expect(isPathPrefix([0, 1], [0, 1, 0])).toBe(true);
    expect(isPathPrefix([0, 1], [0, 10])).toBe(false);
    expect(isPathPrefix([0, 1], [0, 1])).toBe(true);
    // Would be true with naive "0.1".startsWith on "0.10"
    expect(pathKey([0, 1])).toBe("0.1");
    expect(pathKey([0, 10])).toBe("0.10");
    expect(pathKey([0, 10]).startsWith(pathKey([0, 1]))).toBe(true);
    expect(isPathPrefix([0, 1], [0, 10])).toBe(false);
  });

  it("ignores headings inside fenced code", () => {
    const src = `# Real\n\n\`\`\`md\n# Fake\n\`\`\`\n\n## Also\n`;
    const headings = extractHeadings(src);
    expect(headings.map((h) => h.text)).toEqual(["Real", "Also"]);
  });

  it("supports setext headings", () => {
    const src = `Title\n=====\n\nBody\n\nSub\n-----\n\nMore\n`;
    const headings = extractHeadings(src);
    expect(headings).toEqual([
      { line: 1, headingEndLine: 2, level: 1, text: "Title" },
      { line: 6, headingEndLine: 7, level: 2, text: "Sub" },
    ]);
    const tree = buildHeadingTree(src);
    expect(tree[0].bodyStart).toBe(3);
  });

  it("matches CommonMark heading boundaries instead of treating rules as headings", () => {
    const src = `#\n\n   ## Indented\n\n- list item\n---\n\nafter\n`;
    const headings = extractHeadings(src);

    expect(headings).toEqual([
      { line: 1, headingEndLine: 1, level: 1, text: "" },
      {
        line: 3,
        headingEndLine: 3,
        level: 2,
        text: "Indented",
      },
    ]);
  });

  it("uses the complete paragraph for a multiline setext heading", () => {
    const headings = extractHeadings("first line\nsecond line\n---\n\nbody\n");

    expect(headings).toEqual([
      {
        line: 1,
        headingEndLine: 3,
        level: 2,
        text: "first line second line",
      },
    ]);
  });
});

describe("renderMarkdown + line anchors", () => {
  it("renders GFM and stamps anchors", () => {
    const { html, anchors, lineToAnchor } = renderMarkdown(SAMPLE);
    expect(html).toContain("<h1");
    expect(html).toContain("data-anchor-id");
    expect(html).toContain("data-source-line");
    expect(anchors.length).toBeGreaterThan(0);
    expect(lineToAnchor.get(1)?.blockType).toBe("h1");
  });

  it("maps empty lines to nearest anchor preferring previous", () => {
    const anchors: PreviewAnchor[] = [
      { id: "a1", sourceLineStart: 1, sourceLineEnd: 1, blockType: "h1" },
      { id: "a2", sourceLineStart: 5, sourceLineEnd: 5, blockType: "p" },
    ];
    const map = buildLineAnchorMap("a\n\n\n\nb\n", anchors);
    expect(map.get(3)?.id).toBe("a1");
    expect(map.get(4)?.id).toBe("a2");
  });

  it("sanitizes dangerous html", () => {
    const { html } = renderMarkdown(`Hello <script>alert(1)</script> **x**`);
    expect(html).not.toContain("<script");
    expect(html).toContain("<strong>");
  });

  it("keeps footnote links aligned with their sanitized targets", () => {
    const { html } = renderMarkdown("Ref[^n]\n\n[^n]: Footnote text\n");
    expect(html).toContain('href="#user-content-fn-n"');
    expect(html).toContain('id="user-content-fn-n"');
    expect(html).toContain('href="#user-content-fnref-n"');
    expect(html).toContain('id="user-content-fnref-n"');
    expect(html).not.toContain("user-content-user-content-");
  });

  it("keeps mermaid fences as identifiable code blocks with anchors", () => {
    const source = `# Title\n\n\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`\n\nAfter\n`;
    const { html, lineToAnchor, anchors } = renderMarkdown(source);
    expect(html).toContain('class="language-mermaid"');
    expect(html).toContain("<pre");
    expect(html).not.toContain("<svg");

    const fenceAnchor = anchors.find((a) => a.blockType === "pre");
    expect(fenceAnchor).toBeTruthy();
    expect(fenceAnchor?.sourceLineStart).toBe(3);
    expect(fenceAnchor?.sourceLineEnd).toBe(6);
    expect(lineToAnchor.get(4)?.id).toBe(fenceAnchor?.id);
    expect(lineToAnchor.get(5)?.id).toBe(fenceAnchor?.id);
  });

  it("leaves ordinary fenced code unchanged", () => {
    const { html } = renderMarkdown("```js\nconsole.log(1)\n```\n");
    expect(html).toContain('class="language-js"');
    expect(html).not.toContain("language-mermaid");
  });
});

describe("file format", () => {
  it("detects bom and crlf and roundtrips", () => {
    const raw = "\uFEFFhello\r\nworld\r\n";
    const { content, format } = detectFormat(raw);
    expect(content).toBe("hello\nworld\n");
    expect(format).toMatchObject({ lineEnding: "crlf", hasBom: true, encoding: "utf8" });
    expect(serializeContent(content, format)).toBe(raw);
  });

  it("normalizes legacy carriage-return line endings", () => {
    const { content, format } = detectFormat("hello\rworld\r");
    expect(content).toBe("hello\nworld\n");
    expect(format).toMatchObject({ lineEnding: "lf", hasBom: false, encoding: "utf8" });
  });
});

describe("hierarchical collapse visibility", () => {
  it("outer collapsed hides nested headings until expanded", () => {
    const roots = buildHeadingTree(SAMPLE);
    const flat = flattenHeadingTree(roots);
    const collapsed = new Set(flat.map((h) => pathKey(h.path)));
    // Simulate visible ranges: only root-level collapsed sections
    const visible: string[] = [];
    const walk = (nodes: typeof roots, ancestorCollapsed: boolean) => {
      for (const n of nodes) {
        const key = pathKey(n.path);
        const isCollapsed = collapsed.has(key);
        if (!ancestorCollapsed) {
          visible.push(n.text);
        }
        walk(n.children, ancestorCollapsed || isCollapsed);
      }
    };
    walk(roots, false);
    expect(visible).toEqual(["One"]);

    collapsed.delete(pathKey(roots[0].path));
    const visible2: string[] = [];
    const walk2 = (nodes: typeof roots, ancestorCollapsed: boolean) => {
      for (const n of nodes) {
        const key = pathKey(n.path);
        const isCollapsed = collapsed.has(key);
        if (!ancestorCollapsed) {
          visible2.push(n.text);
        }
        walk2(n.children, ancestorCollapsed || isCollapsed);
      }
    };
    walk2(roots, false);
    expect(visible2).toEqual(["One", "Two", "Four"]);
  });
});
