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
    await browser.url("http://localhost:1420/");
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
  });
});
