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
      (window as unknown as { __tomarkE2e?: { setContent: unknown } })
        .__tomarkE2e?.setContent,
    ),
  );
  if (hasBridge) {
    await browser.execute((value) => {
      (
        window as unknown as {
          __tomarkE2e: { setContent: (next: string) => void };
        }
      ).__tomarkE2e.setContent(value);
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
        (await $$(".preview-content .mermaid-diagram[data-mermaid='1'] svg"))
          .length >= 3,
      {
        timeout: 30_000,
        timeoutMsg: "expected at least 3 rendered mermaid SVGs",
      },
    );

    await expect($(".preview-content code.language-js")).toBeExisting();
    await expect($(".preview-content .mermaid-error")).toBeExisting();
    await expect($(".preview-content .mermaid-error")).toHaveText(
      expect.stringContaining("Mermaid 渲染失败"),
    );
  });
});
