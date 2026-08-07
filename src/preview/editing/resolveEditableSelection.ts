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

/**
 * Exact DOM-structure mapping used only as a controlled consistency fallback.
 * Walks text nodes inside the current textblock and applies Range offsets —
 * never searches the document for matching text, and never mutates Selection.
 */
export function mapNativeRangeToPmExact(
  view: EditorView,
): { from: number; to: number; text: string } | null {
  const native = readNativeSelection(view);
  if (!native) {
    return null;
  }
  const { range, text } = native;
  if (range.startContainer !== range.endContainer) {
    return null;
  }
  if (range.startContainer.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const textNode = range.startContainer as Text;

  try {
    const anchorPos = view.state.selection.empty
      ? view.state.selection.head
      : view.state.selection.from;
    const safePos = Math.min(
      Math.max(anchorPos, 1),
      Math.max(1, view.state.doc.content.size - 1),
    );
    const $pos = view.state.doc.resolve(safePos);
    let depth = $pos.depth;
    while (depth > 0 && !$pos.node(depth).isTextblock) {
      depth -= 1;
    }
    if (depth === 0) {
      return null;
    }
    const blockFrom = $pos.start(depth);
    const blockTo = $pos.end(depth);

    const blockDom = view.domAtPos(blockFrom).node;
    const blockEl =
      blockDom.nodeType === Node.TEXT_NODE
        ? blockDom.parentElement
        : blockDom instanceof Element
          ? blockDom
          : null;
    if (!blockEl || !view.dom.contains(blockEl)) {
      return null;
    }

    let base = blockFrom;
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    let current: Node | null = walker.nextNode();
    while (current) {
      const length = current.textContent?.length ?? 0;
      if (current === textNode) {
        const from = base + range.startOffset;
        const to = base + range.endOffset;
        if (from < blockFrom || to > blockTo || to <= from) {
          return null;
        }
        const slice = view.state.doc.textBetween(from, to);
        if (slice !== text) {
          return null;
        }
        return { from, to, text: slice };
      }
      base += length;
      if (base > blockTo) {
        return null;
      }
      current = walker.nextNode();
    }
    return null;
  } catch {
    return null;
  }
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
