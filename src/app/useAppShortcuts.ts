import { onBeforeUnmount, onMounted } from "vue";

export interface AppShortcutHandlers {
  save: () => void | Promise<void>;
  saveAs: () => void | Promise<void>;
  newDocument: () => void | Promise<void>;
  openDocument: () => void | Promise<void>;
  isBlocked?: () => boolean;
}

function isModifierPressed(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function matchAppShortcut(
  event: KeyboardEvent,
): keyof AppShortcutHandlers | null {
  if (!isModifierPressed(event) || event.altKey) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (key === "s") {
    return event.shiftKey ? "saveAs" : "save";
  }
  if (event.shiftKey) {
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
    const action = matchAppShortcut(event);
    if (!action || action === "isBlocked") {
      return;
    }
    if (handlers.isBlocked?.()) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    void handlers[action]();
  };

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown, true);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeyDown, true);
  });
}
