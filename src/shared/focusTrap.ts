const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => {
      if (el.getAttribute("aria-hidden") === "true") {
        return false;
      }
      if (el.tabIndex < 0) {
        return false;
      }
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    },
  );
}

/**
 * Trap Tab focus inside `root`. Returns a disposer that also restores prior focus.
 */
export function trapFocus(root: HTMLElement): () => void {
  const previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  const focusables = getFocusableElements(root);
  const initial = focusables[0] ?? root;
  if (typeof initial.focus === "function") {
    initial.focus({ preventScroll: true });
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab") {
      return;
    }
    const items = getFocusableElements(root);
    if (items.length === 0) {
      event.preventDefault();
      root.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !root.contains(active)) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      }
      return;
    }
    if (active === last || !root.contains(active)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  root.addEventListener("keydown", onKeydown);

  return () => {
    root.removeEventListener("keydown", onKeydown);
    if (
      previouslyFocused &&
      previouslyFocused.isConnected &&
      typeof previouslyFocused.focus === "function"
    ) {
      previouslyFocused.focus({ preventScroll: true });
    }
  };
}
