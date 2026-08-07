import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockAppIpc } from "../helpers/tauriMocks";

const fixtureMarkdown = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../fixtures/export-smoke.md",
  ),
  "utf8",
);

describe("native export (Tauri WebView)", () => {
  beforeEach(async () => {
    await mockAppIpc({
      savePath: "/tmp/tomark-native-export-out.bin",
    });
    await $(".toolbar-title").waitForExist({ timeout: 60_000 });
    await browser.waitUntil(
      async () =>
        await browser.execute(() =>
          Boolean(
            (window as unknown as { __tomarkE2e?: { setContent: unknown } })
              .__tomarkE2e?.setContent,
          ),
        ),
      {
        timeout: 30_000,
        timeoutMsg: "e2e content bridge was not registered",
      },
    );
    await browser.execute((markdown: string) => {
      (
        window as unknown as {
          __tomarkE2e: { setContent: (value: string) => void };
        }
      ).__tomarkE2e.setContent(markdown);
    }, fixtureMarkdown);
  });

  async function openExportPanel() {
    const settings = await $('[data-testid="status-settings"]');
    await settings.waitForExist({ timeout: 15_000 });
    await settings.click();
    await $('[data-testid="settings-drawer"]').waitForDisplayed({ timeout: 15_000 });
    await $('[data-testid="export-settings-panel"]').waitForDisplayed({ timeout: 15_000 });
  }

  async function clickExport(format: string) {
    const button = await $(`[data-testid="export-action-${format}"]`);
    await button.waitForDisplayed({ timeout: 10_000 });
    await button.click();
  }

  it("exports html-embedded through dialog + atomic_write_bytes_file", async () => {
    const mocks = await mockAppIpc({
      savePath: "/tmp/tomark-native-export.html",
    });
    await openExportPanel();
    await clickExport("html-embedded");

    await browser.waitUntil(async () => (await mocks.saveMock.getHistory()).length >= 1, {
      timeout: 30_000,
      timeoutMsg: "save dialog was not invoked",
    });
    await browser.waitUntil(
      async () => (await mocks.writeBytesMock.getHistory()).length >= 1,
      {
        timeout: 60_000,
        timeoutMsg: "atomic_write_bytes_file was not invoked",
      },
    );
  });

  it("exports html-assets through write_html_export_bundle", async () => {
    const mocks = await mockAppIpc({
      savePath: "/tmp/tomark-native-export-assets.html",
    });
    await openExportPanel();
    await clickExport("html-assets");

    await browser.waitUntil(
      async () => (await mocks.writeHtmlBundleMock.getHistory()).length >= 1,
      {
        timeout: 60_000,
        timeoutMsg: "write_html_export_bundle was not invoked",
      },
    );
  });

  it("exports docx and png through write bytes IPC", async () => {
    for (const format of ["docx", "png"] as const) {
      const mocks = await mockAppIpc({
        savePath: `/tmp/tomark-native-export.${format}`,
      });
      await openExportPanel();
      await clickExport(format);
      await browser.waitUntil(
        async () => (await mocks.writeBytesMock.getHistory()).length >= 1,
        {
          timeout: 120_000,
          timeoutMsg: `${format} export did not write bytes`,
        },
      );
    }
  });

  it("exports pdf as single-page %PDF bytes without MissingGlyph on smoke fixture", async () => {
    const mocks = await mockAppIpc({
      savePath: "/tmp/tomark-native-export.pdf",
    });
    await openExportPanel();
    await clickExport("pdf");

    await browser.waitUntil(
      async () => {
        const status = await $(".status").getText();
        if (status.includes("导出失败")) {
          throw new Error(status);
        }
        return (await mocks.writeBytesMock.getHistory()).length >= 1;
      },
      {
        timeout: 180_000,
        timeoutMsg: "PDF export did not write bytes",
      },
    );

    const history = await mocks.writeBytesMock.getHistory();
    const last = history[history.length - 1] as {
      args?: Array<{ contentsBase64?: string }>;
    };
    const contents = Buffer.from(last?.args?.[0]?.contentsBase64 ?? "", "base64");
    expect(contents.length).toBeGreaterThan(8);
    // %PDF
    expect(contents[0]).toBe(0x25);
    expect(contents[1]).toBe(0x50);
    expect(contents[2]).toBe(0x44);
    expect(contents[3]).toBe(0x46);

    const asText = contents.toString("latin1");
    // Vector text PDFs keep font/text operators; a full-page image-only fallback
    // is dominated by large image XObjects without ToUnicode/cmap text.
    expect(asText.includes("Font") || asText.includes("/Type/Font")).toBe(true);
  });

  it("exports paged pdf through dialog + atomic_write_bytes_file", async () => {
    const mocks = await mockAppIpc({
      savePath: "/tmp/tomark-native-export-paged.pdf",
    });
    await openExportPanel();
    await clickExport("pdf-paged");

    await browser.waitUntil(
      async () => {
        const status = await $(".status").getText();
        if (status.includes("导出失败")) {
          throw new Error(status);
        }
        return (await mocks.writeBytesMock.getHistory()).length >= 1;
      },
      {
        timeout: 180_000,
        timeoutMsg: "paged PDF export did not write bytes",
      },
    );

    const history = await mocks.writeBytesMock.getHistory();
    const last = history[history.length - 1] as {
      args?: Array<{ contentsBase64?: string }>;
    };
    const contents = Buffer.from(last?.args?.[0]?.contentsBase64 ?? "", "base64");
    expect(contents[0]).toBe(0x25);
    expect(contents[1]).toBe(0x50);
    expect(contents[2]).toBe(0x44);
    expect(contents[3]).toBe(0x46);
  });
});
