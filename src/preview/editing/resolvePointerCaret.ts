import type { ResolvedPos } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

export interface PointerCaretResolution {
  readonly pos: number;
  readonly blank: true;
}

interface RectBounds {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

interface TextblockBounds {
  readonly element: HTMLElement;
  readonly from: number;
  readonly to: number;
}

interface BlockCandidate {
  readonly element: HTMLElement;
  readonly rect: RectBounds;
  readonly verticalDistance: number;
  readonly horizontalDistance: number;
}

const TEXTBLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6";
const LINE_TOLERANCE = 2;

function isFiniteRect(rect: RectBounds): boolean {
  return (
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.bottom) &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.right) &&
    rect.bottom >= rect.top &&
    rect.right >= rect.left
  );
}

function rectOf(element: Element): RectBounds | null {
  const rect = element.getBoundingClientRect();
  const normalized = {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
  };
  return isFiniteRect(normalized) ? normalized : null;
}

function verticalDistance(rect: RectBounds, y: number): number {
  if (y < rect.top) {
    return rect.top - y;
  }
  if (y > rect.bottom) {
    return y - rect.bottom;
  }
  return 0;
}

function horizontalDistance(rect: RectBounds, x: number): number {
  if (x < rect.left) {
    return rect.left - x;
  }
  if (x > rect.right) {
    return x - rect.right;
  }
  return 0;
}

function pointWithinRoot(view: EditorView, x: number, y: number): boolean {
  const rect = rectOf(view.dom);
  return !!rect &&
    x >= rect.left - LINE_TOLERANCE &&
    x <= rect.right + LINE_TOLERANCE &&
    y >= rect.top - LINE_TOLERANCE &&
    y <= rect.bottom + LINE_TOLERANCE;
}

function elementAtPoint(view: EditorView, x: number, y: number): Element | null {
  const document = view.dom.ownerDocument;
  if (typeof document.elementFromPoint !== "function") {
    return null;
  }
  const element = document.elementFromPoint(x, y);
  return element && view.dom.contains(element) ? element : null;
}

function pointTouchesReadOnlyBlock(
  view: EditorView,
  hit: Element | null,
  y: number,
): boolean {
  if (hit?.closest("[data-tm-readonly]")) {
    return true;
  }
  for (const element of view.dom.querySelectorAll<HTMLElement>(
    ".tm-readonly-block[data-tm-readonly]",
  )) {
    const rect = rectOf(element);
    if (rect && y >= rect.top && y <= rect.bottom) {
      return true;
    }
  }
  return false;
}

function findBlockElement(
  view: EditorView,
  hit: Element | null,
  x: number,
  y: number,
): { element: HTMLElement; relation: "inside" | "before" | "after" } | null {
  const exact = hit?.closest("[data-tm-source-block]");
  if (exact instanceof HTMLElement && view.dom.contains(exact)) {
    const rect = rectOf(exact);
    if (rect) {
      return {
        element: exact,
        relation: y < rect.top ? "before" : y > rect.bottom ? "after" : "inside",
      };
    }
  }

  if (!pointWithinRoot(view, x, y)) {
    return null;
  }

  const candidates: BlockCandidate[] = [];
  for (const element of view.dom.querySelectorAll<HTMLElement>(
    "[data-tm-source-block]",
  )) {
    if (element.closest("[data-tm-readonly]")) {
      continue;
    }
    const rect = rectOf(element);
    if (!rect || (rect.right === rect.left && rect.bottom === rect.top)) {
      continue;
    }
    candidates.push({
      element,
      rect,
      verticalDistance: verticalDistance(rect, y),
      horizontalDistance: horizontalDistance(rect, x),
    });
  }
  candidates.sort(
    (a, b) =>
      a.verticalDistance - b.verticalDistance ||
      a.horizontalDistance - b.horizontalDistance ||
      a.rect.top - b.rect.top ||
      a.rect.left - b.rect.left,
  );
  const nearest = candidates[0];
  if (!nearest) {
    return null;
  }
  return {
    element: nearest.element,
    relation:
      y < nearest.rect.top
        ? "before"
        : y > nearest.rect.bottom
          ? "after"
          : "inside",
  };
}

function textblockAt($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).isTextblock) {
      return depth;
    }
  }
  return -1;
}

function resolveTextblockBounds(
  view: EditorView,
  blockElement: HTMLElement,
): TextblockBounds | null {
  const candidates: HTMLElement[] = [blockElement];
  for (const element of blockElement.querySelectorAll<HTMLElement>(
    TEXTBLOCK_SELECTOR,
  )) {
    candidates.push(element);
  }

  for (const element of candidates) {
    try {
      const raw = view.posAtDOM(element, 0);
      const pos = Math.max(0, Math.min(raw, view.state.doc.content.size));
      const $pos = view.state.doc.resolve(pos);
      const depth = textblockAt($pos);
      if (depth > 0) {
        return {
          element,
          from: $pos.start(depth),
          to: $pos.end(depth),
        };
      }
    } catch {
      // Try a nested DOM candidate.
    }
  }
  return null;
}

function mergeVisualLines(rects: readonly RectBounds[]): RectBounds[] {
  const sorted = rects
    .filter(
      (rect) =>
        isFiniteRect(rect) &&
        rect.bottom > rect.top &&
        rect.right > rect.left,
    )
    .slice()
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: RectBounds[] = [];
  for (const rect of sorted) {
    const current = lines.at(-1);
    const overlap = current
      ? Math.min(rect.bottom, current.bottom) -
        Math.max(rect.top, current.top)
      : 0;
    const minimumHeight = current
      ? Math.min(
          rect.bottom - rect.top,
          current.bottom - current.top,
        )
      : 0;
    if (
      current &&
      overlap > Math.max(1, minimumHeight * 0.5)
    ) {
      lines[lines.length - 1] = {
        top: Math.min(current.top, rect.top),
        bottom: Math.max(current.bottom, rect.bottom),
        left: Math.min(current.left, rect.left),
        right: Math.max(current.right, rect.right),
      };
    } else {
      lines.push(rect);
    }
  }
  return lines;
}

function fallbackLine(
  view: EditorView,
  bounds: TextblockBounds,
): RectBounds | null {
  try {
    const start = view.coordsAtPos(bounds.from, 1);
    const end = view.coordsAtPos(bounds.to, -1);
    const line = {
      top: Math.min(start.top, end.top),
      bottom: Math.max(start.bottom, end.bottom),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
    };
    return isFiniteRect(line) ? line : null;
  } catch {
    return null;
  }
}

function readVisualLines(
  view: EditorView,
  bounds: TextblockBounds,
): RectBounds[] {
  const rects: RectBounds[] = [];
  try {
    const range = bounds.element.ownerDocument.createRange();
    range.selectNodeContents(bounds.element);
    const clientRects = range.getClientRects();
    for (let index = 0; index < clientRects.length; index += 1) {
      const rect = clientRects.item(index);
      if (rect) {
        rects.push({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        });
      }
    }
  } catch {
    // Empty blocks and DOM shims may not expose Range geometry.
  }
  const lines = mergeVisualLines(rects);
  if (lines.length > 0) {
    return lines;
  }
  const fallback = fallbackLine(view, bounds);
  return fallback ? [fallback] : [];
}

function distanceToLine(line: RectBounds, y: number): number {
  return verticalDistance(line, y);
}

function nearestLine(lines: readonly RectBounds[], y: number): RectBounds {
  return lines.reduce((nearest, line) =>
    distanceToLine(line, y) < distanceToLine(nearest, y) ? line : nearest,
  );
}

function caretCenterY(
  view: EditorView,
  pos: number,
  side: -1 | 1,
): number | null {
  try {
    const rect = view.coordsAtPos(pos, side);
    const center = (rect.top + rect.bottom) / 2;
    return Number.isFinite(center) ? center : null;
  } catch {
    return null;
  }
}

function lineEndPosition(
  view: EditorView,
  bounds: TextblockBounds,
  line: RectBounds,
): number {
  let low = bounds.from;
  let high = bounds.to;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const y = caretCenterY(view, middle, -1);
    if (y == null) {
      return bounds.to;
    }
    if (y <= line.bottom + LINE_TOLERANCE) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

function lineStartPosition(
  view: EditorView,
  bounds: TextblockBounds,
  line: RectBounds,
): number {
  let low = bounds.from;
  let high = bounds.to;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const y = caretCenterY(view, middle, 1);
    if (y == null) {
      return bounds.from;
    }
    if (y >= line.top - LINE_TOLERANCE) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function positionAtLineX(
  view: EditorView,
  bounds: TextblockBounds,
  line: RectBounds,
  x: number,
): number {
  const hit = view.posAtCoords({
    left: x,
    top: (line.top + line.bottom) / 2,
  });
  return Math.max(bounds.from, Math.min(hit?.pos ?? bounds.from, bounds.to));
}

/**
 * Resolve pointer coordinates that land in editable-preview whitespace.
 *
 * Text glyph hits deliberately return null so ProseMirror and the browser keep
 * their native selection behavior. Only horizontal trailing/leading whitespace
 * and vertical gaps are mapped here.
 */
export function resolvePointerCaret(
  view: EditorView,
  clientX: number,
  clientY: number,
): PointerCaretResolution | null {
  const hit = elementAtPoint(view, clientX, clientY);
  if (pointTouchesReadOnlyBlock(view, hit, clientY)) {
    return null;
  }
  const block = findBlockElement(view, hit, clientX, clientY);
  if (!block) {
    return null;
  }
  const bounds = resolveTextblockBounds(view, block.element);
  if (!bounds) {
    return null;
  }
  const lines = readVisualLines(view, bounds);
  if (lines.length === 0) {
    return null;
  }

  if (block.relation === "before") {
    return {
      pos: lineStartPosition(view, bounds, lines[0]),
      blank: true,
    };
  }
  if (block.relation === "after") {
    return {
      pos: lineEndPosition(view, bounds, lines[lines.length - 1]),
      blank: true,
    };
  }

  const line = nearestLine(lines, clientY);
  const onGlyphLine =
    clientY >= line.top - LINE_TOLERANCE &&
    clientY <= line.bottom + LINE_TOLERANCE;
  if (
    onGlyphLine &&
    clientX >= line.left - 1 &&
    clientX <= line.right + 1
  ) {
    return null;
  }
  if (clientX < line.left) {
    return {
      pos: lineStartPosition(view, bounds, line),
      blank: true,
    };
  }
  if (clientX > line.right) {
    const pos = lineEndPosition(view, bounds, line);
    return {
      pos,
      blank: true,
    };
  }
  return {
    pos: positionAtLineX(view, bounds, line, clientX),
    blank: true,
  };
}
