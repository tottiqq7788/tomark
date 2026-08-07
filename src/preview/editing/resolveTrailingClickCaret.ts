import type { EditorView } from "prosemirror-view";
import type { EditableProjection } from "@/markdown/buildEditableProjection";

/**
 * When the user clicks the trailing blank of a block-level line, browsers /
 * ProseMirror often resolve the caret into the *next* block. Prefer the end of
 * the block that actually owns the click box (`data-tm-source-block`).
 */
export function resolveTrailingClickCaret(
  view: EditorView,
  event: MouseEvent,
  projection: EditableProjection,
): number | null {
  if (event.button !== 0 || event.shiftKey) {
    return null;
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

  const hit = view.posAtCoords({
    left: event.clientX,
    top: event.clientY,
  });
  if (!hit) {
    return null;
  }

  // Already inside this block's editable content — keep ProseMirror's result.
  if (hit.pos >= block.contentPmFrom && hit.pos <= block.contentPmTo) {
    return null;
  }

  // Click landed on this block's box but resolved outside it (typically the
  // start of the following block). Clamp to the nearer content edge.
  try {
    const endCoords = view.coordsAtPos(block.contentPmTo);
    const startCoords = view.coordsAtPos(block.contentPmFrom);
    const midX = (startCoords.left + endCoords.right) / 2;
    if (event.clientX >= midX) {
      return block.contentPmTo;
    }
    return block.contentPmFrom;
  } catch {
    return block.contentPmTo;
  }
}
