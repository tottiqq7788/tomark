import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Minimal 1×1 PNG. */
export const TINY_PNG_BYTES = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

/** Put a PNG on the macOS system pasteboard (screenshot-like bitmap). */
export function setMacosPasteboardPng(bytes: Uint8Array = TINY_PNG_BYTES): string {
  if (process.platform !== "darwin") {
    throw new Error("macOS pasteboard helper requires darwin");
  }
  const pngPath = path.join(tmpdir(), `tomark-pasteboard-${Date.now()}.png`);
  writeFileSync(pngPath, bytes);
  execFileSync("osascript", [
    "-e",
    `set the clipboard to (read (POSIX file "${pngPath}") as «class PNGf»)`,
  ]);
  return pngPath;
}

export function clearMacosPasteboard(): void {
  if (process.platform !== "darwin") {
    return;
  }
  execFileSync("osascript", ["-e", 'set the clipboard to ""']);
}
