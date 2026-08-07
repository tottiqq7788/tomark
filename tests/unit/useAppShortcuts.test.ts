import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { matchAppShortcut, useAppShortcuts } from "@/app/useAppShortcuts";

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

  describe("history shortcuts outside CodeMirror", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("routes Mod+Z / Mod+Y to undo/redo handlers", async () => {
      const undo = vi.fn(() => true);
      const redo = vi.fn(() => true);
      const Host = defineComponent({
        setup() {
          useAppShortcuts({
            save: () => undefined,
            saveAs: () => undefined,
            newDocument: () => undefined,
            openDocument: () => undefined,
            undo,
            redo,
          });
          return () => h("div");
        },
      });
      const wrapper = mount(Host, { attachTo: document.body });
      await nextTick();

      window.dispatchEvent(keyEvent("z", { metaKey: true }));
      window.dispatchEvent(keyEvent("y", { ctrlKey: true }));
      expect(undo).toHaveBeenCalledOnce();
      expect(redo).toHaveBeenCalledOnce();
      wrapper.unmount();
    });
  });
});
