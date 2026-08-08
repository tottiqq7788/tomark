import {
  dragFromTrailingBlankInto,
  dragSelectPreviewText,
  exerciseBlankCaretRegressionScenarios,
  readSelectionConsistency,
} from "../helpers/previewSelection";

describe("preview selection host (non-editable)", () => {
  beforeEach(async () => {
    await browser.url("/");
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(
            (window as unknown as { __tomarkE2e?: { replaceContent?: unknown } })
              .__tomarkE2e?.replaceContent,
          );
        }),
      { timeout: 30_000, timeoutMsg: "e2e hook not ready" },
    );
  });

  it("does not patch Markdown source when typing in the preview", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("Hello world\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(document.querySelector(".tm-editable-preview"));
        }),
      { timeout: 10_000, timeoutMsg: "editable preview not ready" },
    );

    const before = await browser.execute(() => {
      return (
        window as unknown as { __tomarkE2e: { getContent: () => string } }
      ).__tomarkE2e.getContent();
    });

    await browser.execute(() => {
      const root = document.querySelector(".tm-editable-preview");
      if (!(root instanceof HTMLElement)) {
        return;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent ?? "";
        const index = text.indexOf("world");
        if (index >= 0) {
          const range = document.createRange();
          range.setStart(node, index);
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          break;
        }
        node = walker.nextNode();
      }
      document.execCommand("insertText", false, "X");
      root.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "a",
          code: "KeyA",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await browser.pause(300);
    const after = await browser.execute(() => {
      return (
        window as unknown as { __tomarkE2e: { getContent: () => string } }
      ).__tomarkE2e.getContent();
    });
    expect(after).toBe(before);
  });

  it("keeps fenced code read-only in the preview host", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("Para\n\n```\ncode\n```\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(document.querySelector("[data-tm-readonly]"));
        }),
      { timeout: 10_000 },
    );

    const before = await browser.execute(() => {
      return (
        window as unknown as { __tomarkE2e: { getContent: () => string } }
      ).__tomarkE2e.getContent();
    });

    await browser.execute(() => {
      const readonly = document.querySelector("[data-tm-readonly]");
      if (!(readonly instanceof HTMLElement)) {
        return;
      }
      readonly.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      document.execCommand("insertText", false, "NOPE");
    });

    const after = await browser.execute(() => {
      return (
        window as unknown as { __tomarkE2e: { getContent: () => string } }
      ).__tomarkE2e.getContent();
    });
    expect(after).toBe(before);
  });

  it("supports reverse drag and trailing-blank forward drag selection", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("Hello world today\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(
            document
              .querySelector(".tm-editable-preview")
              ?.textContent?.includes("world"),
          ),
        ),
      { timeout: 10_000 },
    );

    await dragSelectPreviewText("world", { reverse: true });
    await browser.waitUntil(
      async () => (await readSelectionConsistency("world")).matches,
      {
        timeout: 5_000,
        timeoutMsg: "reverse drag did not select world",
      },
    );

    await dragFromTrailingBlankInto("today");
    await browser.waitUntil(
      async () => {
        const native = await browser.execute(
          () => window.getSelection()?.toString() ?? "",
        );
        return native.includes("today") || native.includes("day");
      },
      {
        timeout: 5_000,
        timeoutMsg: "trailing-blank drag did not establish a selection",
      },
    );
  });

  it("resolves wrapped-line, margin, task-list, and jittered blank clicks", async () => {
    await exerciseBlankCaretRegressionScenarios();
  });

  it("renders thematic breaks as a real horizontal rule", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("before\n\n---\n\nafter\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const preview = document.querySelector(".tm-editable-preview");
          if (!(preview instanceof HTMLElement)) {
            return false;
          }
          return Boolean(preview.querySelector("hr"));
        }),
      { timeout: 10_000, timeoutMsg: "thematic break hr not rendered" },
    );

    const state = await browser.execute(() => {
      const preview = document.querySelector(".tm-editable-preview");
      if (!(preview instanceof HTMLElement)) {
        return null;
      }
      const hr = preview.querySelector("hr");
      return {
        hasHr: Boolean(hr),
        text: preview.textContent ?? "",
        readonly: hr?.getAttribute("data-tm-readonly") ?? "",
      };
    });

    expect(state?.hasHr).toBe(true);
    expect(state?.text).not.toContain("分隔线");
    expect(state?.readonly).toContain("thematicBreak");
  });
});
