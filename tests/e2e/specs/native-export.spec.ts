import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";

type ExportHookResult =
  | { ok: true; fileName: string }
  | { ok: false; error: string };

async function runExportToPath(job: {
  format: string;
  path: string;
  markdown: string;
  fileName: string;
  documentPath?: string | null;
}): Promise<ExportHookResult> {
  const resultPath = path.join(tmpdir(), "tomark-force-export-result.json");
  if (existsSync(resultPath)) {
    unlinkSync(resultPath);
  }

  const started = await browser.execute((payload) => {
    const testWindow = window as unknown as {
      __tomarkE2e?: {
        runExportToPath?: (
          value: typeof payload,
        ) => Promise<ExportHookResult>;
      };
    };
    const hook = testWindow.__tomarkE2e?.runExportToPath;
    if (!hook) {
      return false;
    }
    void hook(payload);
    return true;
  }, job);

  if (started !== true) {
    return { ok: false, error: "runExportToPath hook missing" };
  }

  await browser.waitUntil(() => existsSync(resultPath), {
    timeout: 110_000,
    interval: 100,
    timeoutMsg: `export did not finish: ${job.format}`,
  });

  return JSON.parse(readFileSync(resultPath, "utf8")) as ExportHookResult;
}

describe("native export (Tauri WebView)", () => {
  const cleanupPaths: string[] = [];

  beforeEach(async () => {
    await $(".toolbar-title").waitForExist({ timeout: 60_000 });
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Boolean(
            (
              window as unknown as {
                __tomarkE2e?: { runExportToPath?: unknown };
              }
            ).__tomarkE2e?.runExportToPath,
          ),
        ),
      {
        timeout: 30_000,
        timeoutMsg: "e2e export hook was not registered",
      },
    );
  });

  afterEach(() => {
    for (const filePath of cleanupPaths.splice(0)) {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
  });

  it("opens settings export actions in the native shell", async () => {
    const settings = await $('[data-testid="status-settings"]');
    await settings.waitForExist({ timeout: 15_000 });
    await settings.click();
    await $('[data-testid="settings-drawer"]').waitForDisplayed({
      timeout: 15_000,
    });
    await $('[data-testid="export-settings-panel"]').waitForDisplayed({
      timeout: 15_000,
    });
    await expect($('[data-testid="export-action-pdf"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-pdf-paged"]')).toBeDisplayed();
    await expect(
      $('[data-testid="export-action-html-embedded"]'),
    ).toBeDisplayed();
    await expect($('[data-testid="export-action-docx"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-png"]')).toBeDisplayed();
  });

  it("reads a local image and writes embedded HTML through real native IPC", async () => {
    const unique = `${process.pid}-${Date.now()}`;
    const documentPath = path.join(tmpdir(), `tomark-export-${unique}.md`);
    const imagePath = path.join(tmpdir(), `tomark-export-${unique}.png`);
    const outputPath = path.join(tmpdir(), `tomark-export-${unique}.html`);
    cleanupPaths.push(documentPath, imagePath, outputPath);
    writeFileSync(documentPath, "# native export\n");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await runExportToPath({
      format: "html-embedded",
      path: outputPath,
      markdown: `# 原生导出\n\n![local](${path.basename(imagePath)})\n\n\`\`\`mermaid\ngraph TD\nA-->B\n\`\`\``,
      fileName: "native-export.md",
      documentPath,
    });

    expect(result).toEqual({
      ok: true,
      fileName: path.basename(outputPath),
    });
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("原生导出");
    expect(html).toContain("data:image/png;base64,iVBORw==");
    expect(html).toContain('class="mermaid-diagram"');
    expect(html).toContain("<svg");
    expect(html).not.toContain("language-mermaid");
  });

  it("writes real DOCX and PNG bytes through the WebView export renderers", async () => {
    const unique = `${process.pid}-${Date.now()}`;
    const markdown =
      "# Renderer smoke\n\n中文正文。\n\n```mermaid\ngraph TD\nA[中文]-->B[Done]\n```";
    for (const format of ["docx", "png"] as const) {
      const outputPath = path.join(
        tmpdir(),
        `tomark-export-${unique}.${format}`,
      );
      cleanupPaths.push(outputPath);

      const result = await runExportToPath({
        format,
        path: outputPath,
        markdown,
        fileName: "renderer-smoke.md",
      });

      expect(result).toEqual({
        ok: true,
        fileName: path.basename(outputPath),
      });
      const bytes = readFileSync(outputPath);
      expect(bytes.length).toBeGreaterThan(8);
      if (format === "docx") {
        expect(Array.from(bytes.subarray(0, 4))).toEqual([
          0x50, 0x4b, 0x03, 0x04,
        ]);
        const archive = await JSZip.loadAsync(bytes);
        const documentXml = await archive
          .file("word/document.xml")
          ?.async("string");
        expect(documentXml).toMatch(/<w:(drawing|pict)\b/);
      } else {
        expect(Array.from(bytes.subarray(0, 4))).toEqual([
          0x89, 0x50, 0x4e, 0x47,
        ]);
      }
    }
  });

  it("exports Mermaid PDF through the rasterized diagram fallback", async () => {
    const outputPath = path.join(
      tmpdir(),
      `tomark-export-${process.pid}-${Date.now()}.pdf`,
    );
    cleanupPaths.push(outputPath);

    const result = await runExportToPath({
      format: "pdf-paged",
      path: outputPath,
      markdown:
        "# Mermaid PDF\n\n```mermaid\ngraph TD\nA[中文]-->B[Done]\n```",
      fileName: "mermaid-pdf.md",
    });

    expect(result).toEqual({
      ok: true,
      fileName: path.basename(outputPath),
    });
    const bytes = readFileSync(outputPath);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([
      0x25, 0x50, 0x44, 0x46,
    ]);
  });
});
