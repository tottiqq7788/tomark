describe("preview task checkbox toggle", () => {
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

  it("toggles unchecked and checked markers, and undo restores source", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("- [ ] open\n- [x] done\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return (
            document.querySelectorAll(
              '[data-testid="preview-task-checkbox"]',
            ).length >= 2
          );
        }),
      { timeout: 10_000, timeoutMsg: "task checkboxes not rendered" },
    );

    await browser.execute(() => {
      const boxes = document.querySelectorAll(
        '[data-testid="preview-task-checkbox"]',
      );
      (boxes[0] as HTMLElement).click();
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content.includes("- [x] open");
        }),
      { timeout: 10_000, timeoutMsg: "unchecked box did not become [x]" },
    );

    await browser.execute(() => {
      const boxes = document.querySelectorAll(
        '[data-testid="preview-task-checkbox"]',
      );
      (boxes[1] as HTMLElement).click();
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return content.includes("- [ ] done");
        }),
      { timeout: 10_000, timeoutMsg: "checked box did not become [ ]" },
    );

    await browser.execute(() => {
      const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          code: "KeyZ",
          metaKey: isMac,
          ctrlKey: !isMac,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return (
            content.includes("- [x] open") && content.includes("- [x] done")
          );
        }),
      { timeout: 10_000, timeoutMsg: "undo did not restore last toggle" },
    );
  });

  it("Cmd/Ctrl+click on a checkbox locates source instead of toggling", async () => {
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("# Title\n\n- [ ] locate me\n");
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(
            document.querySelector('[data-testid="preview-task-checkbox"]'),
          );
        }),
      { timeout: 10_000 },
    );

    const located = await browser.execute(() => {
      const box = document.querySelector(
        '[data-testid="preview-task-checkbox"]',
      );
      if (!(box instanceof HTMLElement)) {
        return false;
      }
      const rect = box.getBoundingClientRect();
      const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
      box.dispatchEvent(
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
      return true;
    });
    expect(located).toBe(true);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const flash = document.querySelector(".cm-locate-flash");
          return Boolean(flash?.textContent?.includes("locate me"));
        }),
      {
        timeout: 10_000,
        timeoutMsg: "Cmd/Ctrl+click did not locate task checkbox source",
      },
    );

    const content = await browser.execute(() => {
      return (
        window as unknown as { __tomarkE2e: { getContent: () => string } }
      ).__tomarkE2e.getContent();
    });
    expect(content).toContain("- [ ] locate me");
    expect(content).not.toContain("- [x] locate me");
  });
});
