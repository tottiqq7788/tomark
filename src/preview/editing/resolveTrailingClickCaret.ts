import type { EditorView } from "prosemirror-view";
import type { EditableProjection } from "@/markdown/buildEditableProjection";

/**
 * After a confirmed click (not a drag), place the caret at the end of the
 * clicked editable block when the pointer landed in the trailing blank of that
 * block's last visual line.
 *
 * Must never run during drag gestures — callers should use ProseMirror's
 * `handleClick`, which already distinguishes clicks from drags.
 */
export function resolveTrailingClickCaret(
  view: EditorView,
  event: MouseEvent,
  projection: EditableProjection,
): number | null {
  if (event.button !== 0 || event.shiftKey) {
    return null;
  }

  // Non-collapsed selections (including reverse / multi-line drags that settled
  // without enough movement to skip handleClick) must not be rewritten.
  if (!view.state.selection.empty) {
    return null;
  }
  if (typeof window !== "undefined") {
    const native = window.getSelection();
    if (native && !native.isCollapsed) {
      return null;
    }
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }
  const blockEl = target.closest("[data-tm-source-block]");
  if (!(blockEl instanceof HTMLElement)) {
    return null;
  }
  const blockId = blockEl.getAttribute("data-tm-source-block");
  if (!blockId) {
    return null;
  }
  const block = projection.sourceMap.blocks.find((item) => item.id === blockId);
  if (!block || block.policy !== "editable") {
    return null;
  }

  const rect = blockEl.getBoundingClientRect();
  if (event.clientY < rect.top || event.clientY > rect.bottom) {
    return null;
  }

  let endCoords: { left: number; right: number; top: number; bottom: number };
  try {
    endCoords = view.coordsAtPos(block.contentPmTo);
  } catch {
    return null;
  }

  // Restrict to the last visual line of the block.
  const lineTop = Math.min(endCoords.top, endCoords.bottom);
  const lineBottom = Math.max(endCoords.top, endCoords.bottom);
  if (event.clientY < lineTop - 2 || event.clientY > lineBottom + 2) {
    return null;
  }

  // Trailing blank is to the logical right of the content end on that line.
  if (event.clientX < endCoords.right - 1) {
    return null;
  }

  // Already at the desired caret — no rewrite needed.
  if (view.state.selection.head === block.contentPmTo) {
    return null;
  }

  return block.contentPmTo;
}
