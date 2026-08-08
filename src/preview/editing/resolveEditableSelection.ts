import type { EditorView } from "prosemirror-view";
import type { EditableProjection } from "@/markdown/buildEditableProjection";
import type {
  ActiveFormats,
  InlineFormat,
  PreviewFormatSelection,
} from "@/shared/previewFormatting";

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

function markToFormat(mark: string): InlineFormat | null {
  switch (mark) {
    case "strong":
      return "bold";
    case "em":
      return "italic";
    case "strike":
      return "strike";
    case "link":
      return "link";
    default:
      return null;
  }
}

function readNativeSelection(view: EditorView): {
  text: string;
  range: Range;
} | null {
  if (typeof window === "undefined") {
    return null;
  }
  const domSelection = window.getSelection();
  if (
    !domSelection ||
    domSelection.rangeCount === 0 ||
    domSelection.isCollapsed
  ) {
    return null;
  }
  const range = domSelection.getRangeAt(0);
  if (!view.dom.contains(range.commonAncestorContainer)) {
    return null;
  }
  const text = domSelection.toString();
  if (!text) {
    return null;
  }
  return { text, range };
}

function clampPmPos(view: EditorView, pos: number): number {
  return Math.max(0, Math.min(pos, view.state.doc.content.size));
}

function touchesReadonlyAtom(
  view: EditorView,
  from: number,
  to: number,
): boolean {
  if (to <= from) {
    return false;
  }
  let touches = false;
  view.state.doc.nodesBetween(from, to, (node) => {
    if (
      node.type.name === "readonly_inline" ||
      node.type.name === "readonly_block" ||
      node.type.name === "hard_break" ||
      node.type.name === "thematic_break"
    ) {
      touches = true;
      return false;
    }
    return !touches;
  });
  return touches;
}

function isEditableCaretPosition(
  projection: EditableProjection,
  position: number,
): boolean {
  const mapped = projection.sourceMap.mapPmPosition(position, 1);
  if (mapped) {
    return mapped.segment.policy === "editable";
  }
  const block = projection.sourceMap.blockAt(position);
  return !!(
    block &&
    block.policy === "editable" &&
    block.contentPmFrom === block.contentPmTo &&
    position === block.contentPmFrom
  );
}

/**
 * Map the live browser Selection (collapsed or ranged) to ProseMirror positions.
 * Fail-closed: rejects readonly atoms, cross-block ranges, and structural gaps.
 */
export function mapNativeSelectionToPmExact(
  view: EditorView,
  projection: EditableProjection | null = null,
): { from: number; to: number; collapsed: boolean } | null {
  if (typeof window === "undefined") {
    return null;
  }
  const domSelection = window.getSelection();
  if (!domSelection || domSelection.rangeCount === 0) {
    return null;
  }
  const range = domSelection.getRangeAt(0);
  if (!view.dom.contains(range.commonAncestorContainer)) {
    return null;
  }
  if (
    range.commonAncestorContainer instanceof Element &&
    range.commonAncestorContainer.closest("[data-tm-readonly]")
  ) {
    return null;
  }

  let from: number;
  let to: number;
  try {
    from = clampPmPos(
      view,
      view.posAtDOM(range.startContainer, range.startOffset),
    );
    to = clampPmPos(view, view.posAtDOM(range.endContainer, range.endOffset));
  } catch {
    return null;
  }
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  if (touchesReadonlyAtom(view, from, to)) {
    return null;
  }

  if (projection) {
    if (from === to) {
      if (!isEditableCaretPosition(projection, from)) {
        return null;
      }
    } else {
      const resolved = projection.sourceMap.resolveEditableRange(from, to);
      if (!resolved.ok || resolved.blockIds.length !== 1) {
        return null;
      }
    }
  }

  return { from, to, collapsed: from === to };
}

/**
 * Exact DOM-structure mapping used only as a controlled consistency fallback.
 * Walks text nodes inside the current textblock and applies Range offsets —
 * never searches the document for matching text, and never mutates Selection.
 */
export function mapNativeRangeToPmExact(
  view: EditorView,
): { from: number; to: number; text: string } | null {
  const mapped = mapNativeSelectionToPmExact(view);
  if (!mapped || mapped.collapsed) {
    return null;
  }
  const text = view.state.doc.textBetween(mapped.from, mapped.to);
  const native = readNativeSelection(view);
  if (!native || native.text !== text) {
    return null;
  }
  return { from: mapped.from, to: mapped.to, text };
}

export interface ResolveEditableSelectionOptions {
  /** Current CodeMirror / source revision for the immutable snapshot. */
  revision?: number;
  /**
   * When true, prefer an exact native DOM→PM mapping if it validates against
   * document text. Never mutates the editor selection.
   */
  allowNativeExactFallback?: boolean;
}

/**
 * Pure read of a non-collapsed selection into a source-backed format snapshot.
 * Does not mutate ProseMirror state or the browser Selection.
 */
export function resolveEditableFormatSelection(
  view: EditorView | null,
  projection: EditableProjection | null,
  options: ResolveEditableSelectionOptions = {},
): PreviewFormatSelection | null {
  if (!view || !projection) {
    return null;
  }

  const { from: pmSelFrom, to: pmSelTo, empty } = view.state.selection;
  let from = pmSelFrom;
  let to = pmSelTo;
  let usedNativeExact = false;

  if (empty || to <= from) {
    if (!options.allowNativeExactFallback) {
      return null;
    }
    const mapped = mapNativeRangeToPmExact(view);
    if (!mapped) {
      return null;
    }
    from = mapped.from;
    to = mapped.to;
    usedNativeExact = true;
  }

  const pmText = view.state.doc.textBetween(from, to);
  const native = readNativeSelection(view);

  if (
    !usedNativeExact &&
    options.allowNativeExactFallback &&
    native &&
    native.text !== pmText
  ) {
    const mapped = mapNativeRangeToPmExact(view);
    if (!mapped) {
      // Native and PM disagree and exact DOM endpoints did not validate —
      // fail closed rather than guess.
      return null;
    }
    from = mapped.from;
    to = mapped.to;
  }

  const resolved = projection.sourceMap.resolveEditableRange(from, to);
  if (!resolved.ok || resolved.blockIds.length !== 1) {
    return null;
  }

  const sourceFrom = Math.min(
    ...resolved.slices.map((slice) => slice.sourceFrom),
  );
  const sourceTo = Math.max(...resolved.slices.map((slice) => slice.sourceTo));
  if (sourceTo <= sourceFrom) {
    return null;
  }

  const expectedText = projection.sourceMap.source.slice(sourceFrom, sourceTo);
  if (
    native &&
    options.allowNativeExactFallback &&
    expectedText !== native.text &&
    view.state.doc.textBetween(from, to) !== native.text
  ) {
    return null;
  }

  const block = projection.sourceMap.blockAt(from);
  if (!block || block.policy !== "editable") {
    return null;
  }

  const active = emptyActive();
  for (const wrapper of projection.sourceMap.wrappers) {
    if (wrapper.blockId !== block.id) {
      continue;
    }
    if (from < wrapper.pmFrom || to > wrapper.pmTo) {
      continue;
    }
    const format = markToFormat(wrapper.kind);
    if (!format) {
      continue;
    }
    const existing = active.ranges[format];
    const outer = {
      from: wrapper.sourceFrom,
      to: wrapper.sourceTo,
      href:
        wrapper.kind === "link"
          ? (() => {
              const mark = view.state.doc
                .resolve(Math.min(from + 1, to))
                .marks()
                .find((item) => item.type.name === "link");
              return typeof mark?.attrs.href === "string"
                ? mark.attrs.href
                : null;
            })()
          : null,
    };
    if (
      !existing ||
      outer.to - outer.from < existing.to - existing.from
    ) {
      active.ranges[format] = outer;
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
        active.linkHref = active.ranges.link?.href ?? null;
        break;
      default:
        break;
    }
  }

  let rect: PreviewFormatSelection["rect"] | null = null;
  try {
    if (native?.range && typeof native.range.getBoundingClientRect === "function") {
      const bounds = native.range.getBoundingClientRect();
      if (bounds && (bounds.width > 0 || bounds.height > 0)) {
        rect = {
          top: bounds.top,
          left: bounds.left,
          bottom: bounds.bottom,
          right: bounds.right,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
        };
      }
    }
    if (!rect) {
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const top = Math.min(start.top, end.top);
      const bottom = Math.max(start.bottom, end.bottom);
      const left = Math.min(start.left, end.left);
      const right = Math.max(start.right, end.right);
      rect = {
        top,
        left,
        bottom,
        right,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      };
    }
  } catch {
    rect = { top: 8, left: 8, bottom: 24, right: 120, width: 112, height: 16 };
  }

  return {
    from: sourceFrom,
    to: sourceTo,
    blockAnchorId: block.id,
    sourceLine: block.sourceLine,
    active,
    rect,
    expectedText,
    revision: options.revision,
    pmFrom: from,
    pmTo: to,
  };
}

/** Nearest editable block source line for a PM document position. */
export function sourceLineAtPosition(
  projection: EditableProjection,
  position: number,
): number | null {
  const block = projection.sourceMap.blockAt(position);
  if (!block) {
    return null;
  }
  return block.sourceLine;
}
