import {
  backspaceTimes,
  dragSelectPreviewText,
  exerciseBlankCaretRegressionScenarios,
  placeCollapsedCaretInPreviewText,
  readPreviewContent,
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

  it("removes the preview caret after applying inline code", async () => {
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
      { timeout: 15_000 },
    );

    await dragSelectPreviewText("world");
    await browser.waitUntil(
      async () => (await readSelectionConsistency("world")).matches,
      { timeout: 8_000, timeoutMsg: "native inline-code selection mismatch" },
    );

    const codeBtn = await $('[data-testid="format-code"]');
    await codeBtn.waitForDisplayed({ timeout: 10_000 });
    await codeBtn.click();

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          const root = document.querySelector(".tm-editable-preview");
          return (
            content.includes("`world`") &&
            Boolean(
              root?.querySelector(
                '.tm-readonly-inline[data-tm-readonly="inlineCode-read-only"]',
              ),
            ) &&
            document.activeElement !== root
          );
        }),
      {
        timeout: 10_000,
        timeoutMsg: "native inline code did not blur the preview",
      },
    );
  });

  it("resolves wrapped-line, margin, task-list, and jittered blank clicks", async () => {
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

    await exerciseBlankCaretRegressionScenarios();
  });

  it("deletes ordered-list text one character at a time with Backspace", async () => {
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

    const needle =
      "打开文档时沿第一条标题链展开到正文，其余标题折叠；展开另一标题时会收起无关分支，始终只保留一条展开链";
    await browser.execute((text: string) => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent(
        `1. 在左侧改写任意段落\n2. ${text}\n3. 打开文档时沿第一条标题链\n`,
      );
    }, needle);

    await browser.waitUntil(
      async () =>
        browser.execute(
          (text: string) =>
            Boolean(
              document
                .querySelector(".tm-editable-preview")
                ?.textContent?.includes(text),
            ),
          needle,
        ),
      { timeout: 15_000 },
    );

    await placeCollapsedCaretInPreviewText(needle, 12);
    const before = await readPreviewContent();
    await backspaceTimes(3);
    const after = await readPreviewContent();

    expect(after.includes(needle)).toBe(false);
    expect(before.length - after.length).toBe(3);
    expect(after).toContain("1. 在左侧改写任意段落");
    expect(after).toContain("3. 打开文档时沿第一条标题链");
  });
});
