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

/**
 * Map a non-collapsed ProseMirror selection to a source-backed format selection.
 * Fail-closed: unmapped, read-only, or cross-block ranges return null.
 */
export function resolveEditableFormatSelection(
  view: EditorView | null,
  projection: EditableProjection | null,
): PreviewFormatSelection | null {
  if (!view || !projection) {
    return null;
  }
  const { from, to, empty } = view.state.selection;
  if (empty || to <= from) {
    return null;
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
    const domSelection = typeof window !== "undefined" ? window.getSelection() : null;
    const range =
      domSelection &&
      domSelection.rangeCount > 0 &&
      !domSelection.isCollapsed &&
      view.dom.contains(domSelection.getRangeAt(0).commonAncestorContainer)
        ? domSelection.getRangeAt(0)
        : null;
    if (range && typeof range.getBoundingClientRect === "function") {
      const native = range.getBoundingClientRect();
      if (native && (native.width > 0 || native.height > 0)) {
        rect = {
          top: native.top,
          left: native.left,
          bottom: native.bottom,
          right: native.right,
          width: Math.max(1, native.width),
          height: Math.max(1, native.height),
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
