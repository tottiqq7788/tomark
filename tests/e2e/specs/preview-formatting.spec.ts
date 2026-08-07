import {
  dragSelectPreviewText,
  readSelectionConsistency,
} from "../helpers/previewSelection";

describe("preview formatting toolbar", () => {
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

  it("bolds a forward pointer-drag selection through the floating toolbar", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("Hello world today\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(
            document
              .querySelector(".tm-editable-preview")
              ?.textContent?.includes("world"),
          );
        }),
      { timeout: 10_000 },
    );

    await dragSelectPreviewText("world");

    await browser.waitUntil(
      async () => {
        const state = await readSelectionConsistency("world");
        return state.matches;
      },
      {
        timeout: 5_000,
        timeoutMsg: "forward drag selection did not settle on world",
      },
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
          return content.includes("**world**");
        }),
      { timeout: 10_000, timeoutMsg: "toolbar bold did not patch source" },
    );

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(document.querySelector(".tm-editable-preview strong"));
        }),
      { timeout: 10_000, timeoutMsg: "preview did not re-render bold" },
    );
  });

  it("keeps reverse pointer-drag selections consistent for CJK text", async () => {
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
        browser.execute(() => {
          return Boolean(
            document
              .querySelector(".tm-editable-preview")
              ?.textContent?.includes("双向"),
          );
        }),
      { timeout: 10_000 },
    );

    await dragSelectPreviewText("双向", { reverse: true });

    await browser.waitUntil(
      async () => {
        const state = await readSelectionConsistency("双向");
        return state.matches;
      },
      {
        timeout: 5_000,
        timeoutMsg: "reverse drag selection did not settle on 双向",
      },
    );

    const native = await browser.execute(
      () => window.getSelection()?.toString() ?? "",
    );
    expect(native).toBe("双向");

    const copied = await browser.execute(() => {
      const text = window.getSelection()?.toString() ?? "";
      const ok = document.execCommand("copy");
      return { ok, text };
    });
    expect(copied.text).toBe("双向");

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
      { timeout: 10_000, timeoutMsg: "reverse CJK bold did not patch source" },
    );
  });
});
