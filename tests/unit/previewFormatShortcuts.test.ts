import { describe, expect, it } from "vitest";
import {
  isEventFromCodeMirror,
  matchPreviewFormatShortcut,
} from "@/shared/previewFormatShortcuts";

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

describe("previewFormatShortcuts", () => {
  it("matches formatting shortcuts", () => {
    expect(matchPreviewFormatShortcut(keyEvent("b", { metaKey: true }))).toBe(
      "bold",
    );
    expect(matchPreviewFormatShortcut(keyEvent("i", { ctrlKey: true }))).toBe(
      "italic",
    );
    expect(
      matchPreviewFormatShortcut(
        keyEvent("x", { metaKey: true, shiftKey: true }),
      ),
    ).toBe("strike");
    expect(matchPreviewFormatShortcut(keyEvent("e", { metaKey: true }))).toBe(
      "code",
    );
    expect(matchPreviewFormatShortcut(keyEvent("k", { ctrlKey: true }))).toBe(
      "link",
    );
  });

  it("matches undo / redo shortcuts", () => {
    expect(matchPreviewFormatShortcut(keyEvent("z", { metaKey: true }))).toBe(
      "undo",
    );
    expect(matchPreviewFormatShortcut(keyEvent("y", { ctrlKey: true }))).toBe(
      "redo",
    );
    expect(
      matchPreviewFormatShortcut(
        keyEvent("z", { metaKey: true, shiftKey: true }),
      ),
    ).toBe("redo");
  });

  it("ignores unmodified or alt-modified keys", () => {
    expect(matchPreviewFormatShortcut(keyEvent("b"))).toBeNull();
    expect(
      matchPreviewFormatShortcut(keyEvent("b", { metaKey: true, altKey: true })),
    ).toBeNull();
  });

  it("detects events originating from CodeMirror", () => {
    const host = document.createElement("div");
    host.className = "cm-editor";
    const inner = document.createElement("div");
    host.append(inner);
    document.body.append(host);
    const event = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
    });
    Object.defineProperty(event, "target", { value: inner });
    expect(isEventFromCodeMirror(event)).toBe(true);

    const outside = new KeyboardEvent("keydown", {
      key: "z",
      metaKey: true,
      bubbles: true,
    });
    Object.defineProperty(outside, "target", { value: document.body });
    expect(isEventFromCodeMirror(outside)).toBe(false);
    host.remove();
  });
});
