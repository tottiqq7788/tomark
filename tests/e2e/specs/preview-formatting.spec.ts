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

  it("bolds selected preview text through the floating toolbar", async () => {
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
          const root = document.querySelector(".preview-content");
          return Boolean(root?.textContent?.includes("world"));
        }),
      { timeout: 10_000 },
    );

    const selected = await browser.execute(() => {
      const root = document.querySelector(".preview-content");
      if (!(root instanceof HTMLElement)) {
        return false;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = node.textContent ?? "";
        const index = text.indexOf("world");
        if (index >= 0) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 5);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          document.dispatchEvent(new Event("selectionchange"));
          return true;
        }
        node = walker.nextNode();
      }
      return false;
    });
    expect(selected).toBe(true);

    const toolbar = await $('[data-testid="preview-format-toolbar"]');
    await toolbar.waitForDisplayed({ timeout: 5_000 });
    await $('[data-testid="format-bold"]').click();

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content.includes("**world**");
        }),
      { timeout: 10_000, timeoutMsg: "source was not bolded" },
    );

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(document.querySelector(".preview-content strong"));
        }),
      { timeout: 10_000, timeoutMsg: "preview did not re-render bold" },
    );
  });
});
