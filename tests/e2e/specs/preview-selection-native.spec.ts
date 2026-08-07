import {
  dragSelectPreviewText,
  readSelectionConsistency,
} from "../helpers/previewSelection";

/**
 * Native Tauri WebKit selection regressions. Kept separate from Chrome browser
 * E2E because caret/selection hit-testing differs under WKWebView.
 */
describe("preview selection (native WebKit)", () => {
  it("keeps CJK forward/reverse drag selections consistent", async () => {
    const title = await $(".toolbar-title");
    await title.waitForExist({ timeout: 60_000 });

    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(
            (window as unknown as { __tomarkE2e?: { replaceContent?: unknown } })
              .__tomarkE2e?.replaceContent,
          ),
        ),
      { timeout: 30_000, timeoutMsg: "e2e hook not ready" },
    );

    const source =
      "轻量级跨平台 Markdown 编辑器。左侧编辑源码，右侧实时预览；标题可折叠，Cmd/Ctrl+点击可双向定位。\n";
    await browser.execute((value: string) => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent(value);
    }, source);

    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(
            document
              .querySelector(".tm-editable-preview")
              ?.textContent?.includes("双向"),
          ),
        ),
      { timeout: 15_000 },
    );

    const preview = await $(".tm-editable-preview");
    await preview.click();

    await dragSelectPreviewText("双向");
    await browser.waitUntil(
      async () => (await readSelectionConsistency("双向")).matches,
      { timeout: 8_000, timeoutMsg: "forward native drag mismatch" },
    );

    await dragSelectPreviewText("双向", { reverse: true });
    await browser.waitUntil(
      async () => (await readSelectionConsistency("双向")).matches,
      { timeout: 8_000, timeoutMsg: "reverse native drag mismatch" },
    );

    const boldBtn = await $('[data-testid="format-bold"]');
    await boldBtn.waitForDisplayed({ timeout: 10_000 });
    await boldBtn.click();

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content.includes("**双向**");
        }),
      { timeout: 10_000, timeoutMsg: "native WebKit bold mismatch" },
    );
  });
});
