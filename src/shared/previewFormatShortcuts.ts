import type { InlineFormat } from "@/shared/previewFormatting";

export type PreviewFormatShortcut =
  | Exclude<InlineFormat, "link">
  | "link"
  | "undo"
  | "redo";

function isModifierPressed(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

/**
 * Match preview formatting / history shortcuts.
 * Format keys only apply when the caller has an active preview selection.
 * History keys are Mod+Z / Mod+Y (+ Mod+Shift+Z for redo).
 */
export function matchPreviewFormatShortcut(
  event: KeyboardEvent,
): PreviewFormatShortcut | null {
  if (!isModifierPressed(event) || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();

  if (key === "z") {
    if (event.shiftKey) {
      return "redo";
    }
    return "undo";
  }
  if (key === "y" && !event.shiftKey) {
    return "redo";
  }

  if (event.shiftKey) {
    // Strikethrough: Mod+Shift+X (common in markdown editors).
    if (key === "x") {
      return "strike";
    }
    return null;
  }

  if (key === "b") {
    return "bold";
  }
  if (key === "i") {
    return "italic";
  }
  if (key === "e") {
    return "code";
  }
  if (key === "k") {
    return "link";
  }
  return null;
}

/** True when the event target lives inside the CodeMirror editor UI. */
export function isEventFromCodeMirror(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest(".cm-editor"));
}
