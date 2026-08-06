import { describe, expect, it } from "vitest";
import { getFocusableElements, trapFocus } from "@/shared/focusTrap";

describe("focusTrap", () => {
  it("lists focusable elements and cycles Tab within root", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button id="a">A</button>
      <button id="b">B</button>
      <button id="c" disabled>C</button>
    `;
    document.body.appendChild(root);

    const items = getFocusableElements(root);
    expect(items.map((el) => el.id)).toEqual(["a", "b"]);

    const release = trapFocus(root);
    expect(document.activeElement?.id).toBe("a");

    items[1].focus();
    root.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement?.id).toBe("a");

    release();
    document.body.removeChild(root);
  });
});
