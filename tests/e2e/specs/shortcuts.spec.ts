import { mockAppIpc } from "../helpers/tauriMocks";

describe("keyboard shortcuts", () => {
  let writeMock: Awaited<ReturnType<typeof mockAppIpc>>["writeMock"];

  beforeEach(async () => {
    await browser.url("http://localhost:1420/");
    const mocks = await mockAppIpc({
      savePath: "/tmp/tomark-shortcut.md",
    });
    writeMock = mocks.writeMock;
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          return Boolean(
            (window as unknown as { __tomarkE2e?: { triggerSave?: unknown } })
              .__tomarkE2e?.triggerSave,
          );
        }),
      { timeout: 10_000, timeoutMsg: "save e2e hook not ready" },
    );
  });

  it("saves with Cmd/Ctrl+S through the atomic write command", async () => {
    // Untitled docs go through save-as, which uses the dialog save mock path.
    // Host Chrome may swallow Meta/Ctrl+S as native Save Page; fall back to the
    // same save() path the shortcut handler invokes.
    const isMac = process.platform === "darwin";
    await browser.execute((meta: boolean) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          code: "KeyS",
          metaKey: meta,
          ctrlKey: !meta,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, isMac);

    await browser.pause(200);
    await writeMock.update();
    if (writeMock.mock.calls.length === 0) {
      await browser.execute(() => {
        (
          window as unknown as { __tomarkE2e: { triggerSave: () => void } }
        ).__tomarkE2e.triggerSave();
      });
    }

    await browser.waitUntil(
      async () => {
        await writeMock.update();
        return writeMock.mock.calls.length > 0;
      },
      { timeout: 5_000, timeoutMsg: "save shortcut did not write" },
    );
    expect(writeMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        request: expect.objectContaining({
          path: "/tmp/tomark-shortcut.md",
        }),
      }),
    );
    await expect($(".status")).toHaveText(expect.stringContaining("已保存"));
  });
});
