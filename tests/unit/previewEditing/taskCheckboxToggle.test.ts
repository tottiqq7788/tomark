import { describe, expect, it } from "vitest";
import { buildTaskCheckboxTogglePatch } from "@/preview/editing/taskCheckboxToggle";

describe("buildTaskCheckboxTogglePatch", () => {
  it("checks an unchecked marker and keeps trailing spaces", () => {
    const source = "- [ ] buy milk\n";
    const from = 2;
    const to = 6; // "[ ] "
    const patch = buildTaskCheckboxTogglePatch(source, from, to);
    expect(patch).toEqual({
      from,
      to,
      insert: "[x] ",
      expectedText: "[ ] ",
    });
  });

  it("unchecks a checked marker and normalizes X to space", () => {
    const source = "- [X]\tdone\n";
    const from = 2;
    const to = 6; // "[X]\t"
    const patch = buildTaskCheckboxTogglePatch(source, from, to);
    expect(patch).toEqual({
      from,
      to,
      insert: "[ ]\t",
      expectedText: "[X]\t",
    });
  });

  it("rejects non-marker slices", () => {
    expect(buildTaskCheckboxTogglePatch("hello", 0, 5)).toBeNull();
    expect(buildTaskCheckboxTogglePatch("- [] x", 2, 5)).toBeNull();
    expect(buildTaskCheckboxTogglePatch("- [ ]x", 2, 5)).toBeNull();
  });

  it("rejects invalid ranges", () => {
    expect(buildTaskCheckboxTogglePatch("[ ] ", -1, 4)).toBeNull();
    expect(buildTaskCheckboxTogglePatch("[ ] ", 0, 0)).toBeNull();
    expect(buildTaskCheckboxTogglePatch("[ ] ", 0, 99)).toBeNull();
  });
});
