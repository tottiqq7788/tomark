import type {
  ActiveFormats,
  PreviewFormatSelection,
} from "@/shared/previewFormatting";

function parseOffset(raw: string | null): number | null {
  if (raw == null || raw === "") {
    return null;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function closestMappedSpan(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }
  const el =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node instanceof Element
        ? node
        : null;
  if (!el) {
    return null;
  }
  const span = el.closest("[data-tm-from][data-tm-to]");
  return span instanceof HTMLElement ? span : null;
}

function closestBlock(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }
  const el =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node instanceof Element
        ? node
        : null;
  if (!el) {
    return null;
  }
  const block = el.closest("[data-source-line][data-anchor-id]");
  return block instanceof HTMLElement ? block : null;
}

function offsetInMappedSpan(span: HTMLElement, node: Node, offset: number): number | null {
  const from = parseOffset(span.getAttribute("data-tm-from"));
  if (from == null) {
    return null;
  }
  // Prefer the single text child produced by attachSourceRanges.
  const text = span.firstChild;
  if (text && text.nodeType === Node.TEXT_NODE && node === text) {
    const len = text.textContent?.length ?? 0;
    if (offset < 0 || offset > len) {
      return null;
    }
    return from + offset;
  }
  if (node === span) {
    // For Element containers, Range offset is a child index — not a char offset.
    const children = span.childNodes;
    if (offset < 0 || offset > children.length) {
      return null;
    }
    let walked = 0;
    for (let i = 0; i < offset; i += 1) {
      walked += children[i]?.textContent?.length ?? 0;
    }
    return from + walked;
  }
  // Selection landed on a descendant without its own map — walk text length.
  let walked = 0;
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    const textLen = current.textContent?.length ?? 0;
    if (current === node) {
      if (offset < 0 || offset > textLen) {
        return null;
      }
      return from + walked + offset;
    }
    walked += textLen;
    current = walker.nextNode();
  }
  return null;
}

function resolveBoundary(
  container: HTMLElement,
  node: Node,
  offset: number,
): { sourceOffset: number; block: HTMLElement } | null {
  if (!container.contains(node)) {
    return null;
  }
  if (closestBlock(node)?.closest("pre")) {
    return null;
  }
  const block = closestBlock(node);
  if (!block || !container.contains(block)) {
    return null;
  }
  const span = closestMappedSpan(node);
  if (!span || !block.contains(span)) {
    return null;
  }
  const sourceOffset = offsetInMappedSpan(span, node, offset);
  if (sourceOffset == null) {
    return null;
  }
  return { sourceOffset, block };
}

function emptyActive(): ActiveFormats {
  return {
    bold: false,
    italic: false,
    strike: false,
    code: false,
    link: false,
    linkHref: null,
    ranges: {},
  };
}

function formatsCoveringRange(
  block: HTMLElement,
  from: number,
  to: number,
): ActiveFormats {
  const active = emptyActive();
  const nodes = block.querySelectorAll<HTMLElement>("[data-tm-format]");
  for (const el of nodes) {
    const f = parseOffset(el.getAttribute("data-tm-from"));
    const t = parseOffset(el.getAttribute("data-tm-to"));
    const format = el.getAttribute("data-tm-format") as
      | "bold"
      | "italic"
      | "strike"
      | "code"
      | "link"
      | null;
    if (f == null || t == null || !format || t <= f) {
      continue;
    }
    // Active when the selection sits fully inside this format's outer span.
    if (from >= f && to <= t) {
      const href =
        format === "link" ? el.getAttribute("data-tm-href") : null;
      const existing = active.ranges[format];
      // Keep the tightest covering range.
      if (!existing || t - f < existing.to - existing.from) {
        active.ranges[format] = { from: f, to: t, href };
      }
      switch (format) {
        case "bold":
          active.bold = true;
          break;
        case "italic":
          active.italic = true;
          break;
        case "strike":
          active.strike = true;
          break;
        case "code":
          active.code = true;
          break;
        case "link":
          active.link = true;
          active.linkHref = active.ranges.link?.href ?? href;
          break;
        default:
          break;
      }
    }
  }
  return active;
}

/**
 * Map the current browser selection inside `container` to a Markdown source
 * range. Returns null when the selection is collapsed, outside the preview,
 * cross-block, inside a fenced code block, or not character-mapped.
 */
export function resolvePreviewSelection(
  container: HTMLElement | null,
): PreviewFormatSelection | null {
  if (!container) {
    return null;
  }
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) {
    return null;
  }

  const start = resolveBoundary(container, range.startContainer, range.startOffset);
  const end = resolveBoundary(container, range.endContainer, range.endOffset);
  if (!start || !end) {
    return null;
  }
  if (start.block !== end.block) {
    return null;
  }

  const from = Math.min(start.sourceOffset, end.sourceOffset);
  const to = Math.max(start.sourceOffset, end.sourceOffset);
  if (to <= from) {
    return null;
  }

  // Ensure every character in the DOM selection sits on mapped text spans.
  // If the selection includes unmapped nodes (br, images, generated footnotes),
  // refuse rather than guess.
  if (!selectionFullyMapped(start.block, from, to, range)) {
    return null;
  }

  const anchorId = start.block.getAttribute("data-anchor-id");
  const lineRaw = start.block.getAttribute("data-source-line");
  const sourceLine = lineRaw ? Number.parseInt(lineRaw, 10) : Number.NaN;
  if (!anchorId || !Number.isFinite(sourceLine) || sourceLine < 1) {
    return null;
  }

  const rect = getRangeClientRect(range);
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return null;
  }

  return {
    from,
    to,
    blockAnchorId: anchorId,
    sourceLine,
    active: formatsCoveringRange(start.block, from, to),
    rect: {
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      width: rect.width,
      height: rect.height,
    },
  };
}

function getRangeClientRect(range: Range): {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
} | null {
  if (typeof range.getBoundingClientRect === "function") {
    try {
      const rect = range.getBoundingClientRect();
      if (rect) {
        return {
          top: rect.top,
          left: rect.left,
          bottom: rect.bottom,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      }
    } catch {
      // jsdom may not implement Range geometry.
    }
  }
  const node =
    range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer instanceof Element
        ? range.startContainer
        : null;
  if (!node || typeof node.getBoundingClientRect !== "function") {
    // Deterministic fallback for unit tests without layout.
    return { top: 8, left: 8, bottom: 24, right: 120, width: 112, height: 16 };
  }
  const rect = node.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom,
    right: rect.right,
    width: rect.width || 1,
    height: rect.height || 1,
  };
}

function selectionFullyMapped(
  block: HTMLElement,
  from: number,
  to: number,
  range: Range,
): boolean {
  const spans = [...block.querySelectorAll<HTMLElement>("[data-tm-from][data-tm-to]")];
  const covering = spans
    .map((span) => {
      const f = parseOffset(span.getAttribute("data-tm-from"));
      const t = parseOffset(span.getAttribute("data-tm-to"));
      if (f == null || t == null || t <= f) {
        return null;
      }
      return { f, t, span };
    })
    .filter((x): x is { f: number; t: number; span: HTMLElement } => x !== null)
    .filter((x) => x.t > from && x.f < to)
    .sort((a, b) => a.f - b.f);

  if (covering.length === 0) {
    return false;
  }

  // Covered source offsets must be contiguous from `from` to `to`.
  let cursor = from;
  for (const piece of covering) {
    if (piece.f > cursor) {
      return false;
    }
    cursor = Math.max(cursor, piece.t);
  }
  if (cursor < to) {
    return false;
  }

  // Also reject when the live DOM range contains element nodes that are not
  // mapped text wrappers (e.g. raw <br> without offsets).
  const contents = range.cloneContents();
  const walker = document.createTreeWalker(contents, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      if (tag === "br" || tag === "img" || tag === "hr") {
        return false;
      }
    }
    node = walker.nextNode();
  }
  return true;
}

/** Keep the toolbar near the selection while clamping into the viewport. */
export function clampToolbarPosition(
  selectionRect: PreviewFormatSelection["rect"],
  toolbarSize: { width: number; height: number },
  viewport: { width: number; height: number } = {
    width: window.innerWidth,
    height: window.innerHeight,
  },
  gap = 8,
): { top: number; left: number } {
  const preferredTop = selectionRect.top - toolbarSize.height - gap;
  const top =
    preferredTop >= gap
      ? preferredTop
      : Math.min(selectionRect.bottom + gap, viewport.height - toolbarSize.height - gap);
  const centerLeft = selectionRect.left + selectionRect.width / 2 - toolbarSize.width / 2;
  const left = Math.min(
    Math.max(gap, centerLeft),
    Math.max(gap, viewport.width - toolbarSize.width - gap),
  );
  return { top: Math.max(gap, top), left };
}
