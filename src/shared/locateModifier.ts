/**
 * Locate gesture: Cmd on macOS, Ctrl on Windows/Linux.
 * Avoids Mac Ctrl+click (context menu) acting as locate.
 */
export function isLocateModifier(event: MouseEvent): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }
  const isApple =
    typeof navigator !== "undefined" &&
    (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ||
      /Mac OS X/i.test(navigator.userAgent));
  if (isApple) {
    return event.metaKey && !event.ctrlKey;
  }
  return event.ctrlKey && !event.metaKey;
}
