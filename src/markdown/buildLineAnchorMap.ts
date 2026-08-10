import type { Element, Parents, Root, RootContent } from "hast";
import type { PreviewAnchor } from "@/shared/types";

const ANCHORABLE_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "hr",
]);

function isElement(node: RootContent | Parents): node is Element {
  return node.type === "element";
}

function readLine(node: Element): { start: number; end: number } | null {
  const pos = node.position;
  if (!pos?.start?.line || !pos?.end?.line) {
    return null;
  }
  return { start: pos.start.line, end: pos.end.line };
}

function readOffsets(node: Element): { from: number; to: number } | null {
  const pos = node.position;
  if (
    pos?.start?.offset == null ||
    pos?.end?.offset == null ||
    !Number.isFinite(pos.start.offset) ||
    !Number.isFinite(pos.end.offset) ||
    pos.end.offset < pos.start.offset
  ) {
    return null;
  }
  return { from: pos.start.offset, to: pos.end.offset };
}

function classNameTokens(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string") {
    return value.split(/\s+/);
  }
  return [];
}

function isMermaidPre(node: Element): boolean {
  if (node.tagName.toLowerCase() !== "pre") {
    return false;
  }
  for (const child of node.children) {
    if (!isElement(child) || child.tagName.toLowerCase() !== "code") {
      continue;
    }
    const tokens = classNameTokens(child.properties?.className);
    if (
      tokens.some(
        (token: string) => token.toLowerCase() === "language-mermaid",
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Walk HAST and stamp data-anchor attributes on renderable blocks.
 * Returns anchors collected in document order.
 */
export function attachAnchors(tree: Root): PreviewAnchor[] {
  const anchors: PreviewAnchor[] = [];
  let counter = 0;

  const visit = (node: Root | Element) => {
    if (!isElement(node)) {
      if (node.type === "root") {
        for (const child of node.children) {
          if (isElement(child)) {
            visit(child);
          }
        }
      }
      return;
    }

    const lines = readLine(node);
    const tag = node.tagName.toLowerCase();
    const shouldAnchor = ANCHORABLE_TAGS.has(tag) && lines !== null;

    if (shouldAnchor && lines) {
      counter += 1;
      const id = `tm-a-${counter}`;
      const nextProperties = {
        ...node.properties,
        dataSourceLine: String(lines.start),
        dataSourceEnd: String(lines.end),
        dataAnchorId: id,
      } as typeof node.properties;
      // Mermaid fences also get character offsets for visual-edit write-back.
      // Numeric only — never stamp source text onto DOM.
      if (isMermaidPre(node) && nextProperties) {
        const offsets = readOffsets(node);
        if (offsets) {
          nextProperties.dataTmFrom = String(offsets.from);
          nextProperties.dataTmTo = String(offsets.to);
        }
      }
      node.properties = nextProperties;
      anchors.push({
        id,
        sourceLineStart: lines.start,
        sourceLineEnd: lines.end,
        blockType: tag,
      });
    }

    for (const child of node.children) {
      if (isElement(child)) {
        visit(child);
      }
    }
  };

  visit(tree);
  return anchors;
}

/**
 * Build per-source-line map. Empty / uncovered lines resolve to the nearest
 * anchor (prefer previous when equidistant).
 */
export function buildLineAnchorMap(
  source: string,
  anchors: PreviewAnchor[],
): Map<number, PreviewAnchor> {
  const lines = source.length === 0 ? [""] : source.split(/\r?\n/);
  const total = lines.length;
  const map = new Map<number, PreviewAnchor>();

  if (anchors.length === 0 || total === 0) {
    return map;
  }

  // Prefer most specific (nested) anchors: later stamps for same line win if
  // they have a tighter range; we iterate and keep best by range size.
  const direct = new Map<number, PreviewAnchor>();
  for (const anchor of anchors) {
    for (let line = anchor.sourceLineStart; line <= anchor.sourceLineEnd; line += 1) {
      if (line < 1 || line > total) {
        continue;
      }
      const existing = direct.get(line);
      if (!existing) {
        direct.set(line, anchor);
        continue;
      }
      const existingSpan = existing.sourceLineEnd - existing.sourceLineStart;
      const nextSpan = anchor.sourceLineEnd - anchor.sourceLineStart;
      // Prefer tighter (more specific) blocks; for equal span prefer list items / later.
      if (nextSpan < existingSpan) {
        direct.set(line, anchor);
      } else if (nextSpan === existingSpan) {
        const specificity = (a: PreviewAnchor) =>
          a.blockType === "li" || a.blockType === "tr" ? 2 : a.blockType === "p" ? 1 : 0;
        if (specificity(anchor) >= specificity(existing)) {
          direct.set(line, anchor);
        }
      }
    }
  }

  const sortedStarts = [...anchors].sort(
    (a, b) => a.sourceLineStart - b.sourceLineStart,
  );

  for (let line = 1; line <= total; line += 1) {
    const hit = direct.get(line);
    if (hit) {
      map.set(line, hit);
      continue;
    }

    let prev: PreviewAnchor | null = null;
    let next: PreviewAnchor | null = null;
    for (const anchor of sortedStarts) {
      if (anchor.sourceLineEnd < line) {
        prev = anchor;
      } else if (anchor.sourceLineStart > line && next === null) {
        next = anchor;
        break;
      }
    }

    if (prev && next) {
      const dPrev = line - prev.sourceLineEnd;
      const dNext = next.sourceLineStart - line;
      map.set(line, dPrev <= dNext ? prev : next);
    } else if (prev) {
      map.set(line, prev);
    } else if (next) {
      map.set(line, next);
    }
  }

  return map;
}
