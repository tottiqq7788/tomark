import type { SourcePatch } from "@/shared/previewEditing";

/** Matches projection task markers: `[ ] ` / `[x] ` / `[X]\t` etc. */
export const TASK_MARKER_SLICE_RE = /^\[([ xX])\]([ \t]+)$/;

export interface TaskCheckboxToggleRequest {
  readonly from: number;
  readonly to: number;
  readonly expectedText: string;
  readonly revision: number;
}

/**
 * Build a single-slice source patch that flips `[ ]` ↔ `[x]` while keeping
 * trailing whitespace. Returns null when the slice is not a task marker.
 */
export function buildTaskCheckboxTogglePatch(
  source: string,
  from: number,
  to: number,
): SourcePatch | null {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to > source.length ||
    to <= from
  ) {
    return null;
  }
  const expectedText = source.slice(from, to);
  const match = TASK_MARKER_SLICE_RE.exec(expectedText);
  if (!match) {
    return null;
  }
  const checked = match[1] === "x" || match[1] === "X";
  const insert = `[${checked ? " " : "x"}]${match[2]}`;
  return {
    from,
    to,
    insert,
    expectedText,
  };
}
