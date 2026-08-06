import { isMacOS } from "./isMacOS";

/**
 * Locate gesture: Cmd on macOS, Ctrl on Windows/Linux.
 * Avoids Mac Ctrl+click (context menu) acting as locate.
 */
export function isLocateModifier(event: MouseEvent): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }
  if (isMacOS()) {
    return event.metaKey && !event.ctrlKey;
  }
  return event.ctrlKey && !event.metaKey;
}
