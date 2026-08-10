describe("window close guard", () => {
  it("shows the dirty dialog when closing a dirty window", async () => {
    const title = await $(".toolbar-title");
    await title.waitForExist({ timeout: 60_000 });
    await title.waitForDisplayed();

    const isWindows = await browser.execute(() =>
      /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent),
    );
    if (isWindows) {
      await expect($("[data-testid='app-toolbar']")).toHaveElementClass(
        "is-windows-custom",
      );
      await expect($("[data-testid='windows-file-menu']")).toBeDisplayed();
      await expect($("[data-testid='windows-window-controls']")).toBeDisplayed();
    }

    // Wait for the async editor chunk to mount.
    const editor = await $(".cm-content");
    await editor.waitForExist({ timeout: 60_000 });

    // Prefer the VITE_WDIO bridge: WKWebView keyboard input into CodeMirror is flaky.
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          return Boolean(
            (window as unknown as { __tomarkE2e?: { setContent: unknown } })
              .__tomarkE2e?.setContent,
          );
        }),
      {
        timeout: 15_000,
        timeoutMsg: "e2e content bridge was not registered",
      },
    );
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { setContent: (value: string) => void };
        }
      ).__tomarkE2e.setContent("unsaved close guard");
    });

    await browser.waitUntil(
      async () => (await browser.getTitle()).includes("*"),
      {
        timeout: 10_000,
        timeoutMsg: "document did not become dirty after editing",
      },
    );

    // Do not await close(): when prevented it may not settle, and when allowed
    // the embedded WebDriver server dies with the window.
    if (isWindows) {
      await $("[data-testid='window-close']").click();
    } else {
      await browser.execute(() => {
        const api = (
          window as unknown as {
            __TAURI__?: {
              window?: {
                getCurrentWindow: () => { close: () => Promise<void> };
              };
            };
          }
        ).__TAURI__;
        if (!api?.window) {
          throw new Error("Tauri window API unavailable");
        }
        void api.window.getCurrentWindow().close();
      });
    }

    const dialog = await $('[data-testid="dirty-dialog"]');
    await dialog.waitForDisplayed({ timeout: 15_000 });
    // Cancel keeps the window (and embedded WebDriver) alive for clean teardown.
    await $('[data-testid="dirty-cancel"]').click();
    await dialog.waitForDisplayed({ reverse: true, timeout: 10_000 });
  });
});
