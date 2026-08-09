describe("preview link plain-click open", () => {
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

  it("opens a safe https link on plain click without changing source", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent(
        "See [tomark 仓库](https://github.com/tottiqq7788/tomark).\n",
      );
      const w = window as unknown as {
        __openedUrls?: string[];
        open: typeof window.open;
      };
      w.__openedUrls = [];
      w.open = ((url?: string | URL) => {
        w.__openedUrls!.push(String(url ?? ""));
        return null;
      }) as typeof window.open;
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const link = document.querySelector(
            '.tm-editable-preview a[href*="github.com"]',
          );
          return Boolean(link?.textContent?.includes("tomark"));
        }),
      { timeout: 10_000, timeoutMsg: "preview link not rendered" },
    );

    await browser.execute(() => {
      const link = document.querySelector(
        '.tm-editable-preview a[href*="github.com"]',
      );
      if (!(link instanceof HTMLAnchorElement)) {
        throw new Error("link missing");
      }
      link.click();
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const urls =
            (window as unknown as { __openedUrls?: string[] }).__openedUrls ??
            [];
          return urls.some((url) =>
            url.includes("https://github.com/tottiqq7788/tomark"),
          );
        }),
      { timeout: 10_000, timeoutMsg: "plain click did not open link" },
    );

    const content = await browser.execute(() => {
      return (
        window as unknown as { __tomarkE2e: { getContent: () => string } }
      ).__tomarkE2e.getContent();
    });
    expect(content).toContain(
      "[tomark 仓库](https://github.com/tottiqq7788/tomark)",
    );
  });

  it("Cmd/Ctrl+click locates source and does not open the link", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent(
        "# Title\n\nSee [locate link](https://example.com/docs).\n",
      );
      const w = window as unknown as {
        __openedUrls?: string[];
        open: typeof window.open;
      };
      w.__openedUrls = [];
      w.open = ((url?: string | URL) => {
        w.__openedUrls!.push(String(url ?? ""));
        return null;
      }) as typeof window.open;
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(
            document.querySelector(
              '.tm-editable-preview a[href*="example.com"]',
            ),
          );
        }),
      { timeout: 10_000 },
    );

    await browser.execute(() => {
      const link = document.querySelector(
        '.tm-editable-preview a[href*="example.com"]',
      );
      if (!(link instanceof HTMLAnchorElement)) {
        throw new Error("link missing");
      }
      const rect = link.getBoundingClientRect();
      const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          metaKey: isMac,
          ctrlKey: !isMac,
        }),
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const flash = document.querySelector(".cm-locate-flash");
          return Boolean(flash?.textContent?.includes("locate link"));
        }),
      {
        timeout: 10_000,
        timeoutMsg: "Cmd/Ctrl+click did not locate link source",
      },
    );

    const opened = await browser.execute(() => {
      return (
        (window as unknown as { __openedUrls?: string[] }).__openedUrls ?? []
      );
    });
    expect(opened).toEqual([]);
  });
});
