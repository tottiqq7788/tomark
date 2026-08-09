import { mockAppIpc } from "../helpers/tauriMocks";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function setEditorContent(content: string) {
  const hasBridge = await browser.execute(() =>
    Boolean(
      (
        window as unknown as {
          __tomarkE2e?: { replaceContent?: unknown; setContent?: unknown };
        }
      ).__tomarkE2e?.replaceContent ??
        (
          window as unknown as {
            __tomarkE2e?: { replaceContent?: unknown; setContent?: unknown };
          }
        ).__tomarkE2e?.setContent,
    ),
  );
  if (!hasBridge) {
    throw new Error("missing __tomarkE2e content bridge");
  }
  await browser.execute((value) => {
    const hooks = (
      window as unknown as {
        __tomarkE2e: {
          replaceContent?: (next: string) => void;
          setContent: (next: string) => void;
        };
      }
    ).__tomarkE2e;
    (hooks.replaceContent ?? hooks.setContent)(value);
  }, content);
}

describe("markdown image preview", () => {
  before(async () => {
    await mockAppIpc();
  });

  it("shows image toolbar on plain click and supports fullscreen", async () => {
    await browser.url("/");
    await setEditorContent(`# Images\n\n![tiny](${TINY_PNG})\n`);

    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(
            document.querySelector(
              ".preview-content .preview-image[data-preview-image='1'] img",
            ),
          ),
        ),
      {
        timeout: 15_000,
        timeoutMsg: "preview image did not resolve",
      },
    );

    await browser.execute(() => {
      const img = document.querySelector(
        ".preview-content .preview-image[data-preview-image='1'] img",
      );
      if (!(img instanceof Element)) {
        throw new Error("missing preview image");
      }
      const rect = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }),
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const toolbar = document.querySelector(
            '[data-testid="preview-image-toolbar"]',
          );
          return Boolean(
            toolbar &&
              getComputedStyle(toolbar).display !== "none" &&
              document.querySelector('[data-testid="image-fullscreen"]') &&
              document.querySelector('[data-testid="image-copy-image"]') &&
              document
                .querySelector('[data-testid="image-export-png"]')
                ?.textContent?.trim() === "PNG",
          );
        }),
      {
        timeout: 10_000,
        timeoutMsg: "expected image toolbar with fullscreen/copy/PNG",
      },
    );

    await $('[data-testid="image-fullscreen"]').click();
    await $('[data-testid="image-fullscreen-viewer"]').waitForDisplayed({
      timeout: 10_000,
    });
    await $('[data-testid="image-viewer-close"]').click();
    await browser.waitUntil(
      async () =>
        !(await $('[data-testid="image-fullscreen-viewer"]').isExisting()),
      { timeout: 5_000, timeoutMsg: "image viewer did not close" },
    );
  });
});
