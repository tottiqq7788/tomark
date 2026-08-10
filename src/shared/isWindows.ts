/** Detect Windows without making browser previews depend on a Tauri plugin. */
export function isWindows(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent);
}
