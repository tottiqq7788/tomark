import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import {
  clearMacosPasteboard,
  setMacosPasteboardPng,
  TINY_PNG_BYTES,
} from "../helpers/macosClipboard";
import { nativePasteFixture } from "../wdio.native-paste.conf";

function assetsDir(): string {
  return path.join(path.dirname(nativePasteFixture.mdPath), "assets");
}

async function ensureFixtureDocumentOpen(): Promise<void> {
  const opened = await browser.execute(async (filePath) => {
    const hooks = (
      window as unknown as {
        __tomarkE2e?: {
          openDocumentAtPath?: (value: string) => Promise<boolean>;
          getDocumentPath?: () => string | null;
        };
      }
    ).__tomarkE2e;
    if (!hooks?.openDocumentAtPath || !hooks.getDocumentPath) {
      return false;
    }
    const current = hooks.getDocumentPath();
    if (current === filePath) {
      return true;
    }
    return hooks.openDocumentAtPath(filePath);
  }, nativePasteFixture.mdPath);
  expect(opened).toBe(true);

  await browser.waitUntil(
    async () =>
      browser.execute((filePath) => {
        const hooks = (
          window as unknown as {
            __tomarkE2e?: { getDocumentPath?: () => string | null };
          }
        ).__tomarkE2e;
        return hooks?.getDocumentPath?.() === filePath;
      }, nativePasteFixture.mdPath),
    {
      timeout: 15_000,
      timeoutMsg: "fixture markdown was not opened with a document path",
    },
  );
}

async function runScreenshotPasteHook(): Promise<string> {
  await browser.execute(() => {
    const w = window as unknown as {
      __tomarkPasteResult?: { ok: boolean; error?: string } | null;
      __tomarkE2e?: {
        pasteEditorScreenshotClipboard?: () => Promise<boolean>;
      };
    };
    w.__tomarkPasteResult = null;
    const hook = w.__tomarkE2e?.pasteEditorScreenshotClipboard;
    if (!hook) {
      w.__tomarkPasteResult = { ok: false, error: "hook missing" };
      return;
    }
    void hook().then(
      (ok) => {
        w.__tomarkPasteResult = { ok };
      },
      (error: unknown) => {
        w.__tomarkPasteResult = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      },
    );
  });

  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const result = (
          window as unknown as {
            __tomarkPasteResult?: { ok: boolean } | null;
          }
        ).__tomarkPasteResult;
        return result !== null && result !== undefined;
      }),
    {
      timeout: 20_000,
      timeoutMsg: "screenshot paste hook did not settle",
    },
  );

  return browser.execute(() => {
    const result = (
      window as unknown as {
        __tomarkPasteResult?: { ok: boolean; error?: string } | null;
      }
    ).__tomarkPasteResult;
    if (!result) {
      return "missing";
    }
    if (result.ok) {
      return "ok";
    }
    return result.error ?? "failed";
  });
}

describe("editor paste image (native macOS WebKit)", () => {
  before(function () {
    if (process.platform !== "darwin") {
      this.skip();
    }
  });

  beforeEach(async () => {
    await $(".toolbar-title").waitForExist({ timeout: 60_000 });
    await $(".cm-content").waitForExist({ timeout: 30_000 });

    // Error dialogs otherwise block the paste promise until dismissed.
    const messageMock = await browser.tauri.mock("plugin:dialog|message");
    await messageMock.mockResolvedValue(null);

    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(
            (
              window as unknown as {
                __tomarkE2e?: {
                  pasteEditorScreenshotClipboard?: unknown;
                };
              }
            ).__tomarkE2e?.pasteEditorScreenshotClipboard,
          ),
        ),
      {
        timeout: 30_000,
        timeoutMsg: "e2e paste screenshot hook not ready",
      },
    );

    await ensureFixtureDocumentOpen();
    await browser.execute(() => {
      (
        window as unknown as {
          __tomarkE2e: { replaceContent: (value: string) => void };
        }
      ).__tomarkE2e.replaceContent("# paste fixture\n\n");
    });

    const assets = assetsDir();
    if (existsSync(assets)) {
      rmSync(assets, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    try {
      clearMacosPasteboard();
    } catch {
      // best-effort cleanup
    }
  });

  it("pastes macOS screenshot clipboard into assets/ via WebKit paste path", async () => {
    setMacosPasteboardPng(TINY_PNG_BYTES);

    const editor = await $(".cm-content");
    await editor.click();

    const pasteStatus = await runScreenshotPasteHook();
    expect(pasteStatus).toBe("ok");

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const content = (
            window as unknown as { __tomarkE2e: { getContent: () => string } }
          ).__tomarkE2e.getContent();
          return /!\[\]\(assets\/pasted-.+\.png\)/.test(content);
        }),
      {
        timeout: 20_000,
        timeoutMsg: "native paste did not insert relative image markdown",
      },
    );

    const assets = assetsDir();
    await browser.waitUntil(() => existsSync(assets), {
      timeout: 10_000,
      timeoutMsg: "assets/ directory was not created",
    });
    const pngFiles = readdirSync(assets).filter((name) => name.endsWith(".png"));
    expect(pngFiles.length).toBeGreaterThanOrEqual(1);
    const written = readFileSync(path.join(assets, pngFiles[0]!));
    expect(written[0]).toBe(0x89);
    expect(written[1]).toBe(0x50);
    expect(written[2]).toBe(0x4e);
    expect(written[3]).toBe(0x47);

    await browser.waitUntil(
      async () =>
        browser.execute(() => {
          const img = document.querySelector(
            ".tm-preview-image, .preview img, img",
          ) as HTMLImageElement | null;
          return Boolean(img && img.complete && img.naturalWidth > 0);
        }),
      {
        timeout: 15_000,
        timeoutMsg: "preview did not load pasted image",
      },
    );
  });
});
