import { describe, expect, it } from "vitest";
import { matchAppShortcut } from "@/app/useAppShortcuts";

function keyEvent(
  key: string,
  options: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

describe("useAppShortcuts", () => {
  it("matches save / saveAs / new / open shortcuts", () => {
    expect(matchAppShortcut(keyEvent("s", { metaKey: true }))).toBe("save");
    expect(matchAppShortcut(keyEvent("s", { ctrlKey: true, shiftKey: true }))).toBe(
      "saveAs",
    );
    expect(matchAppShortcut(keyEvent("n", { metaKey: true }))).toBe("newDocument");
    expect(matchAppShortcut(keyEvent("o", { ctrlKey: true }))).toBe("openDocument");
  });

  it("defers file ops to the native menu when requested", () => {
    expect(
      matchAppShortcut(keyEvent("n", { metaKey: true }), { fileOpsViaMenu: true }),
    ).toBeNull();
    expect(
      matchAppShortcut(keyEvent("s", { metaKey: true, shiftKey: true }), {
        fileOpsViaMenu: true,
      }),
    ).toBeNull();
    expect(
      matchAppShortcut(keyEvent("s", { metaKey: true }), { fileOpsViaMenu: true }),
    ).toBe("save");
  });

  it("ignores shortcuts without a modifier", () => {
    expect(matchAppShortcut(keyEvent("s"))).toBeNull();
    expect(matchAppShortcut(keyEvent("s", { altKey: true, metaKey: true }))).toBeNull();
  });
});
