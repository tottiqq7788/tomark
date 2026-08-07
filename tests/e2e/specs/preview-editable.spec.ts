import {
  clickTrailingBlankAfter,
  dragFromTrailingBlankInto,
  dragSelectPreviewText,
  readSelectionConsistency,
} from "../helpers/previewSelection";

describe("editable preview typing", () => {
  beforeEach(async () => {
    await browser.url("http://localhost:1420/");
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

  it("types into a paragraph and patches Markdown source", async () => {
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

    const typed = await browser.execute(() => {
      const root = document.querySelector(".tm-editable-preview");
      if (!(root instanceof HTMLElement)) {
        return false;
      }
      root.focus();
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
      return true;
    });
    expect(typed).toBe(true);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content.includes("Xworld") || content.includes("Hello X");
        }),
      { timeout: 10_000, timeoutMsg: "editable preview did not patch source" },
    );
  });

  it("keeps fenced code read-only in the editable preview", async () => {
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

  it("inserts at the clicked glyph without painting a block outline", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent(
        "Hello world\n\n- list item\n\n| A | B |\n| - | - |\n| 1 | 2 |\n",
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => Boolean(document.querySelector(".tm-editable-preview"))),
      { timeout: 10_000 },
    );

    const result = await browser.execute(() => {
      const root = document.querySelector(".tm-editable-preview");
      if (!(root instanceof HTMLElement)) {
        return { ok: false, reason: "no-root" };
      }

      const findText = (needle: string): Text | null => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if ((node.textContent ?? "").includes(needle)) {
            return node as Text;
          }
          node = walker.nextNode();
        }
        return null;
      };

      const clickGlyph = (needle: string, offsetInNeedle: number) => {
        const text = findText(needle);
        if (!text) {
          return false;
        }
        const start = (text.textContent ?? "").indexOf(needle) + offsetInNeedle;
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + 1);
        const rect = range.getBoundingClientRect();
        const x = rect.left + Math.max(1, rect.width / 2);
        const y = rect.top + Math.max(1, rect.height / 2);
        const target = document.elementFromPoint(x, y);
        target?.dispatchEvent(
          new MouseEvent("mousedown", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
        target?.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
        target?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
        const selection = window.getSelection();
        selection?.removeAllRanges();
        const caret = document.createRange();
        caret.setStart(text, start);
        caret.collapse(true);
        selection?.addRange(caret);
        return true;
      };

      if (!clickGlyph("world", 0)) {
        return { ok: false, reason: "click-world" };
      }
      document.execCommand("insertText", false, "Q");

      const focused = document.querySelector(".tm-preview-focus");
      const outlinePainted = Boolean(focused);

      return { ok: true, outlinePainted };
    });

    expect(result.ok).toBe(true);
    expect(result.outlinePainted).toBe(false);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content.includes("Qworld") || content.includes("Hello Q");
        }),
      { timeout: 10_000, timeoutMsg: "click insert did not land on glyph" },
    );
  });

  it("undoes a preview edit through the unified history shortcut", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("Hello world\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => Boolean(document.querySelector(".tm-editable-preview"))),
      { timeout: 10_000 },
    );

    await browser.execute(() => {
      const root = document.querySelector(".tm-editable-preview");
      if (!(root instanceof HTMLElement)) {
        return;
      }
      root.focus();
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
      document.execCommand("insertText", false, "Z");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content.includes("Zworld") || content.includes("Hello Z");
        }),
      { timeout: 10_000 },
    );

    const isMac = process.platform === "darwin";
    await browser.execute((meta: boolean) => {
      const root = document.querySelector(".tm-editable-preview");
      root?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          metaKey: meta,
          ctrlKey: !meta,
          bubbles: true,
          cancelable: true,
        }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          metaKey: meta,
          ctrlKey: !meta,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, isMac);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content === "Hello world\n";
        }),
      { timeout: 10_000, timeoutMsg: "undo did not restore preview source" },
    );
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

  it("places caret at block end after a trailing-blank click", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent(
        "- 已打开文件：停止输入约 2 秒后自动保存\n- 未命名文档：用菜单落盘\n",
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(
            document
              .querySelector(".tm-editable-preview")
              ?.textContent?.includes("自动保存"),
          ),
        ),
      { timeout: 10_000 },
    );

    await clickTrailingBlankAfter("自动保存");
    await browser.keys(["!"]);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content.includes("自动保存!");
        }),
      {
        timeout: 10_000,
        timeoutMsg: "trailing blank click did not insert at block end",
      },
    );
  });
});
