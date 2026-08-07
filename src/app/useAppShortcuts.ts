import { onBeforeUnmount, onMounted } from "vue";
import {
  isEventFromCodeMirror,
  matchPreviewFormatShortcut,
} from "@/shared/previewFormatShortcuts";

export interface AppShortcutHandlers {
  save: () => void | Promise<void>;
  saveAs: () => void | Promise<void>;
  newDocument: () => void | Promise<void>;
  openDocument: () => void | Promise<void>;
  undo?: () => boolean;
  redo?: () => boolean;
  isBlocked?: () => boolean;
  /** Flush preview IME / pending edit session before file or history actions. */
  beforeAction?: () => void | Promise<void>;
  /** When true, New/Open/Save As are handled by the native File menu. */
  fileOpsViaMenu?: boolean | (() => boolean);
}

function resolveFlag(value: boolean | (() => boolean) | undefined): boolean {
  if (typeof value === "function") {
    return value();
  }
  return Boolean(value);
}

function isModifierPressed(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function matchAppShortcut(
  event: KeyboardEvent,
  options?: { fileOpsViaMenu?: boolean },
): "save" | "saveAs" | "newDocument" | "openDocument" | null {
  if (!isModifierPressed(event) || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "s") {
    if (event.shiftKey) {
      return options?.fileOpsViaMenu ? null : "saveAs";
    }
    return "save";
  }
  if (event.shiftKey) {
    return null;
  }
  if (options?.fileOpsViaMenu) {
    return null;
  }
  if (key === "n") {
    return "newDocument";
  }
  if (key === "o") {
    return "openDocument";
  }
  return null;
}

export function useAppShortcuts(handlers: AppShortcutHandlers) {
  const onKeyDown = (event: KeyboardEvent) => {
    // Undo/redo: let CodeMirror handle keys while focus is in the editor;
    // otherwise route to the editor history (e.g. after preview formatting).
    const historyAction = matchPreviewFormatShortcut(event);
    if (
      (historyAction === "undo" || historyAction === "redo") &&
      !isEventFromCodeMirror(event)
    ) {
      if (handlers.isBlocked?.()) {
        event.preventDefault();
        return;
      }
      handlers.beforeAction?.();
      const ran =
        historyAction === "undo"
          ? handlers.undo?.() ?? false
          : handlers.redo?.() ?? false;
      if (ran) {
        event.preventDefault();
      }
      return;
    }

    const action = matchAppShortcut(event, {
      fileOpsViaMenu: resolveFlag(handlers.fileOpsViaMenu),
    });
    if (!action) {
      return;
    }
    if (handlers.isBlocked?.()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    handlers.beforeAction?.();
    void handlers[action]();
  };

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown, true);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeyDown, true);
  });
}
