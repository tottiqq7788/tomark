import { describe, expect, it } from "vitest";
import {
  clampEditorRatio,
  DEFAULT_EDITOR_RATIO,
  MAX_EDITOR_RATIO,
  MIN_PANE_RATIO,
} from "@/app/usePaneSplit";

describe("usePaneSplit", () => {
  it("keeps the default editor ratio at one third", () => {
    expect(DEFAULT_EDITOR_RATIO).toBeCloseTo(1 / 3);
  });

  it("clamps ratios so both panes stay usable", () => {
    expect(clampEditorRatio(-1)).toBe(MIN_PANE_RATIO);
    expect(clampEditorRatio(2)).toBe(MAX_EDITOR_RATIO);
    expect(clampEditorRatio(0.5)).toBe(0.5);
    expect(clampEditorRatio(Number.NaN)).toBe(DEFAULT_EDITOR_RATIO);
  });
});
