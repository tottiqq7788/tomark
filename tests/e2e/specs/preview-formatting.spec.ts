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
          return Boolean(
            document.querySelector(".tm-editable-preview")?.textContent?.includes(
              "world",
            ),
          );
        }),
      { timeout: 10_000 },
    );

    const selected = await browser.execute(() => {
      const api = (
        window as unknown as {
          __tomarkE2e?: {
            getContent: () => string;
            selectPreviewRange?: (from: number, to: number) => boolean;
          };
        }
      ).__tomarkE2e;
      if (!api?.selectPreviewRange) {
        return { ok: false, reason: "missing-select-hook" };
      }
      const content = api.getContent();
      const from = content.indexOf("world");
      if (from < 0) {
        return { ok: false, reason: "missing-needle", content };
      }
      return {
        ok: api.selectPreviewRange(from, from + 5),
        from,
      };
    });
    expect(selected).toMatchObject({ ok: true });

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
          return Boolean(
            document.querySelector(".tm-editable-preview strong"),
          );
        }),
      { timeout: 10_000, timeoutMsg: "preview did not re-render bold" },
    );
  });
});
