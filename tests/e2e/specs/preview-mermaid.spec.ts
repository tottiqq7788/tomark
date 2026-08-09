import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockAppIpc } from "../helpers/tauriMocks";

const fixture = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/mermaid-sample.md",
  ),
  "utf8",
);

async function setEditorContent(content: string) {
  const hasBridge = await browser.execute(() =>
    Boolean(
      (
        window as unknown as {
          __tomarkE2e?: { replaceContent?: unknown; setContent?: unknown };
        }
      ).__tomarkE2e?.replaceContent ??
        (
          window as unknown as {
            __tomarkE2e?: { replaceContent?: unknown; setContent?: unknown };
          }
        ).__tomarkE2e?.setContent,
    ),
  );
  if (hasBridge) {
    await browser.execute((value) => {
      const hooks = (
        window as unknown as {
          __tomarkE2e: {
            replaceContent?: (next: string) => void;
            setContent: (next: string) => void;
          };
        }
      ).__tomarkE2e;
      (hooks.replaceContent ?? hooks.setContent)(value);
    }, content);
    return;
  }

  const editor = await $(".cm-content");
  await editor.waitForExist({ timeout: 30_000 });
  await editor.click();
  const isMac = process.platform === "darwin";
  await browser.keys([isMac ? "Meta" : "Control", "a"]);
  const inserted = await browser.execute((value) => {
    const target = document.querySelector(".cm-content");
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    target.focus();
    return document.execCommand("insertText", false, value);
  }, content);
  if (!inserted) {
    throw new Error("failed to insert mermaid fixture into editor");
  }
}

describe("mermaid preview", () => {
  beforeEach(async () => {
    await browser.url("/");
    await mockAppIpc();
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
    await $(".cm-content").waitForExist({ timeout: 30_000 });
  });

  it("renders stable mermaid diagrams and isolates invalid syntax", async () => {
    await setEditorContent(fixture);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const preview = document.querySelector(".tm-editable-preview");
          return Boolean(
            preview?.textContent?.includes("Mermaid fixtures") &&
              document.querySelectorAll(".tm-readonly-mermaid").length === 4,
          );
        }),
      {
        timeout: 30_000,
        timeoutMsg: "expected the preview to rebuild from the Mermaid fixture",
      },
    );

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return (
            document.querySelectorAll(
              ".preview-content .mermaid-diagram[data-mermaid='1'] svg",
            ).length === 3 &&
            document.querySelectorAll(
              ".preview-content .mermaid-error[data-mermaid-error='1']",
            ).length === 1
          );
        }),
      {
        timeout: 30_000,
        timeoutMsg: "expected exactly 3 Mermaid SVGs and 1 error block",
      },
    );

    const ordinaryCode = await browser.execute(() => {
      return Boolean(
        document.querySelector(".preview-content code.language-js") ||
          document.querySelector(".preview-content .tm-readonly-code"),
      );
    });
    expect(ordinaryCode).toBe(true);
    await expect($(".preview-content .mermaid-error")).toBeExisting();
    await expect($(".preview-content .mermaid-error")).toHaveText(
      expect.stringContaining("Mermaid 渲染失败"),
    );

    const located = await browser.execute(() => {
      const svg = document.querySelector(".tm-readonly-mermaid svg");
      if (!(svg instanceof SVGElement)) {
        return false;
      }
      const rect = svg.getBoundingClientRect();
      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
      svg.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          metaKey: isMac,
          ctrlKey: !isMac,
        }),
      );
      return true;
    });
    expect(located).toBe(true);
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return (
            document.querySelector(".cm-locate-flash")?.textContent?.trim() ===
            "```mermaid"
          );
        }),
      {
        timeout: 10_000,
        timeoutMsg: "Cmd/Ctrl+click did not locate the Mermaid source fence",
      },
    );

    const toolbarHiddenAfterLocate = await browser.execute(() => {
      const toolbar = document.querySelector(
        '[data-testid="preview-mermaid-toolbar"]',
      );
      return !toolbar || getComputedStyle(toolbar).display === "none";
    });
    expect(toolbarHiddenAfterLocate).toBe(true);
  });

  it("shows icon toolbar on plain click and supports fullscreen viewport", async () => {
    await setEditorContent(fixture);

    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelectorAll(
              ".preview-content .mermaid-diagram[data-mermaid='1'] svg",
            ).length === 3,
        ),
      {
        timeout: 30_000,
        timeoutMsg: "expected Mermaid SVGs before toolbar interaction",
      },
    );

    await browser.execute(() => {
      const svg = document.querySelector(
        ".preview-content .mermaid-diagram[data-mermaid='1'] svg",
      );
      if (!(svg instanceof Element)) {
        throw new Error("missing mermaid svg");
      }
      const rect = svg.getBoundingClientRect();
      svg.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const toolbar = document.querySelector(
            '[data-testid="preview-mermaid-toolbar"]',
          );
          const svgBtn = document.querySelector(
            '[data-testid="mermaid-export-svg"]',
          );
          const pngBtn = document.querySelector(
            '[data-testid="mermaid-export-png"]',
          );
          return Boolean(
            toolbar &&
              getComputedStyle(toolbar).display !== "none" &&
              document.querySelector('[data-testid="mermaid-fullscreen"]') &&
              document.querySelector('[data-testid="mermaid-copy-source"]') &&
              svgBtn?.textContent?.trim() === "SVG" &&
              pngBtn?.textContent?.trim() === "PNG" &&
              !document.querySelector('[data-testid="mermaid-locate-source"]'),
          );
        }),
      {
        timeout: 10_000,
        timeoutMsg:
          "expected Mermaid toolbar: fullscreen, copy, SVG, PNG (no locate)",
      },
    );

    await browser.execute(() => {
      const win = window as unknown as {
        __tomarkClipboard?: string;
      };
      win.__tomarkClipboard = "";
      const clipboard = {
        writeText: async (text: string) => {
          win.__tomarkClipboard = text;
        },
      };
      try {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          writable: true,
          value: clipboard,
        });
      } catch {
        (navigator as unknown as { clipboard: typeof clipboard }).clipboard =
          clipboard;
      }
    });
    await $('[data-testid="mermaid-copy-source"]').click();
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const status = document.querySelector(".status-left")?.textContent ?? "";
          const text = (
            window as unknown as { __tomarkClipboard?: string }
          ).__tomarkClipboard;
          return (
            status.includes("已复制 Mermaid 源码") ||
            Boolean(text && text.includes("graph") && !text.includes("```"))
          );
        }),
      {
        timeout: 8_000,
        timeoutMsg: "copy-source did not report success or write clipboard mock",
      },
    );

    await $('[data-testid="mermaid-fullscreen"]').click();
    await $('[data-testid="mermaid-fullscreen-viewer"]').waitForDisplayed({
      timeout: 10_000,
    });

    const scaleBefore = await $(
      ".mermaid-viewer-scale",
    ).getText();
    await $('[data-testid="mermaid-viewer-zoom-in"]').click();
    await browser.waitUntil(
      async () => (await $(".mermaid-viewer-scale").getText()) !== scaleBefore,
      {
        timeout: 5_000,
        timeoutMsg: "zoom-in did not change scale label",
      },
    );
    await $('[data-testid="mermaid-viewer-reset"]').click();
    await browser.waitUntil(
      async () => (await $(".mermaid-viewer-scale").getText()) === "100%",
      {
        timeout: 5_000,
        timeoutMsg: "reset did not reach 100%",
      },
    );

    await browser.execute(() => {
      const viewport = document.querySelector(".mermaid-viewer-viewport");
      if (!(viewport instanceof HTMLElement)) {
        throw new Error("missing viewport");
      }
      const rect = viewport.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      viewport.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: x,
          clientY: y,
          pointerId: 1,
        }),
      );
      viewport.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          button: 0,
          clientX: x + 40,
          clientY: y + 20,
          pointerId: 1,
        }),
      );
      viewport.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          button: 0,
          clientX: x + 40,
          clientY: y + 20,
          pointerId: 1,
        }),
      );
    });

    await $('[data-testid="mermaid-viewer-close"]').click();
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            !document.querySelector('[data-testid="mermaid-fullscreen-viewer"]'),
        ),
      {
        timeout: 5_000,
        timeoutMsg: "fullscreen viewer did not close",
      },
    );

    await browser.execute(() => {
      const hooks = (
        window as unknown as {
          __tomarkE2e: {
            replaceContent?: (next: string) => void;
            setContent: (next: string) => void;
          };
        }
      ).__tomarkE2e;
      (hooks.replaceContent ?? hooks.setContent)("# rebuilt\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const toolbar = document.querySelector(
            '[data-testid="preview-mermaid-toolbar"]',
          );
          return !toolbar || getComputedStyle(toolbar).display === "none";
        }),
      {
        timeout: 10_000,
        timeoutMsg: "stale Mermaid toolbar remained after rebuild",
      },
    );
  });
});
