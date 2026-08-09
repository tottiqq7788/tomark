import { mockAppIpc } from "../helpers/tauriMocks";

const TINY_PNG_BYTES = Array.from(
  Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    ),
    (c) => c.charCodeAt(0),
  ),
);

describe("editor paste image", () => {
  beforeEach(async () => {
    await browser.url("/");
    await mockAppIpc({ savePath: "/tmp/tomark-e2e-paste.md" });
    await $(".toolbar-title").waitForExist({ timeout: 30_000 });
    await $(".cm-content").waitForExist({ timeout: 30_000 });
  });

  it("saves untitled doc then inserts relative markdown image", async () => {
    const ok = await browser.executeAsync((bytes, done) => {
      const hooks = (
        window as unknown as {
          __tomarkE2e?: {
            pasteEditorImage?: (next: number[]) => Promise<boolean>;
          };
        }
      ).__tomarkE2e;
      if (!hooks?.pasteEditorImage) {
        done(false);
        return;
      }
      void hooks.pasteEditorImage(bytes).then(
        (value) => done(value),
        () => done(false),
      );
    }, TINY_PNG_BYTES);

    expect(ok).toBe(true);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const hooks = (
            window as unknown as {
              __tomarkE2e?: { getContent?: () => string };
            }
          ).__tomarkE2e;
          const content = hooks?.getContent?.() ?? "";
          return content.includes("![](assets/pasted-e2e.png)");
        }),
      {
        timeout: 15_000,
        timeoutMsg: "pasted image markdown was not inserted",
      },
    );
  });
});
