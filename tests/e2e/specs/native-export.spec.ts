import {
  existsSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const requireFromHere = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { PDFDocument } = requireFromHere(
  path.join(repoRoot, "deps/node_modules/pdf-lib"),
) as typeof import("pdf-lib");

function cleanupPath(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }
  rmSync(filePath, { recursive: true, force: true });
}

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
      cleanupPath(filePath);
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
    await expect(
      $('[data-testid="export-action-html-embedded"]'),
    ).toBeDisplayed();
    await expect(
      $('[data-testid="export-action-html-assets"]'),
    ).toBeDisplayed();
    await expect($('[data-testid="export-action-png"]')).toBeDisplayed();
    await expect($('[data-testid="export-action-pdf"]')).toBeDisplayed();
    await expect(
      $('[data-testid="export-action-docx"]'),
    ).not.toBeDisplayed();
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

  it("writes HTML asset bundles with a sibling files directory", async () => {
    const unique = `${process.pid}-${Date.now()}`;
    const documentPath = path.join(tmpdir(), `tomark-export-${unique}.md`);
    const imagePath = path.join(tmpdir(), `tomark-export-${unique}.png`);
    const outputPath = path.join(tmpdir(), `tomark-export-${unique}.html`);
    const assetsDir = path.join(
      tmpdir(),
      `tomark-export-${unique}_files`,
    );
    cleanupPaths.push(documentPath, imagePath, outputPath, assetsDir);
    writeFileSync(documentPath, "# native export\n");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const result = await runExportToPath({
      format: "html-assets",
      path: outputPath,
      markdown: `# 资源目录\n\n![local](${path.basename(imagePath)})\n`,
      fileName: "native-assets.md",
      documentPath,
    });

    expect(result).toEqual({
      ok: true,
      fileName: path.basename(outputPath),
    });
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("资源目录");
    expect(html).toMatch(/src="tomark-export-.*_files\//);
    expect(existsSync(assetsDir)).toBe(true);
  });

  it("writes real PNG bytes through the WebView export renderer", async () => {
    const unique = `${process.pid}-${Date.now()}`;
    const markdown =
      "# Renderer smoke\n\n中文正文。\n\n```mermaid\ngraph TD\nA[中文]-->B[Done]\n```";
    const outputPath = path.join(tmpdir(), `tomark-export-${unique}.png`);
    cleanupPaths.push(outputPath);

    const result = await runExportToPath({
      format: "png",
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
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("writes a single-page long-image PDF through the WebView export renderer", async () => {
    const unique = `${process.pid}-${Date.now()}`;
    const markdown =
      "# PDF smoke\n\n中文正文。\n\n```mermaid\ngraph TD\nA[中文]-->B[Done]\n```";
    const outputPath = path.join(tmpdir(), `tomark-export-${unique}.pdf`);
    cleanupPaths.push(outputPath);

    const result = await runExportToPath({
      format: "pdf",
      path: outputPath,
      markdown,
      fileName: "pdf-smoke.md",
    });

    expect(result).toEqual({
      ok: true,
      fileName: path.basename(outputPath),
    });
    const bytes = readFileSync(outputPath);
    expect(bytes.length).toBeGreaterThan(8);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect(width).toBeGreaterThan(1);
    expect(height).toBeGreaterThan(1);
  });

  it("exports a single Mermaid diagram PNG at 2× with white background path", async () => {
    const unique = `${process.pid}-${Date.now()}`;
    const outputPath = path.join(
      tmpdir(),
      `tomark-mermaid-diagram-${unique}.png`,
    );
    cleanupPaths.push(outputPath);

    const resultPath = path.join(tmpdir(), "tomark-force-export-result.json");
    if (existsSync(resultPath)) {
      unlinkSync(resultPath);
    }

    await browser.execute(() => {
      const hooks = (
        window as unknown as {
          __tomarkE2e: {
            replaceContent?: (next: string) => void;
            setContent: (next: string) => void;
          };
        }
      ).__tomarkE2e;
      (hooks.replaceContent ?? hooks.setContent)(
        "# Mermaid PNG\n\n```mermaid\ngraph TD\nA[中文]-->B[Done]\n```\n",
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelectorAll(
              ".preview-content .mermaid-diagram[data-mermaid='1'] svg",
            ).length >= 1,
        ),
      {
        timeout: 45_000,
        timeoutMsg: "mermaid diagram was not ready for single PNG export",
      },
    );

    const started = await browser.execute((payload) => {
      const testWindow = window as unknown as {
        __tomarkE2e?: {
          runMermaidDiagramPngToPath?: (
            value: typeof payload,
          ) => Promise<ExportHookResult>;
        };
      };
      const hook = testWindow.__tomarkE2e?.runMermaidDiagramPngToPath;
      if (!hook) {
        return false;
      }
      void hook(payload);
      return true;
    }, { path: outputPath, diagramIndex: 1 });

    expect(started).toBe(true);
    await browser.waitUntil(() => existsSync(resultPath), {
      timeout: 110_000,
      interval: 100,
      timeoutMsg: "single Mermaid PNG export did not finish",
    });
    const result = JSON.parse(
      readFileSync(resultPath, "utf8"),
    ) as ExportHookResult;
    expect(result).toEqual({
      ok: true,
      fileName: path.basename(outputPath),
    });

    const bytes = readFileSync(outputPath);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // IHDR chunk: width / height are big-endian u32 at bytes 16..24
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    // Fixed 2× rasterization should produce even pixel dimensions for integer SVG sizes.
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
  });

  it("exports a single Mermaid diagram SVG through the native path", async () => {
    const unique = `${process.pid}-${Date.now()}`;
    const outputPath = path.join(
      tmpdir(),
      `tomark-mermaid-diagram-${unique}.svg`,
    );
    cleanupPaths.push(outputPath);

    const resultPath = path.join(tmpdir(), "tomark-force-export-result.json");
    if (existsSync(resultPath)) {
      unlinkSync(resultPath);
    }

    await browser.execute(() => {
      const hooks = (
        window as unknown as {
          __tomarkE2e: {
            replaceContent?: (next: string) => void;
            setContent: (next: string) => void;
          };
        }
      ).__tomarkE2e;
      (hooks.replaceContent ?? hooks.setContent)(
        "# Mermaid SVG\n\n```mermaid\ngraph TD\nA[中文]-->B[Done]\n```\n",
      );
    });

    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelectorAll(
              ".preview-content .mermaid-diagram[data-mermaid='1'] svg",
            ).length >= 1,
        ),
      {
        timeout: 45_000,
        timeoutMsg: "mermaid diagram was not ready for single SVG export",
      },
    );

    const started = await browser.execute((payload) => {
      const testWindow = window as unknown as {
        __tomarkE2e?: {
          runMermaidDiagramSvgToPath?: (
            value: typeof payload,
          ) => Promise<ExportHookResult>;
        };
      };
      const hook = testWindow.__tomarkE2e?.runMermaidDiagramSvgToPath;
      if (!hook) {
        return false;
      }
      void hook(payload);
      return true;
    }, { path: outputPath, diagramIndex: 1 });

    expect(started).toBe(true);
    await browser.waitUntil(() => existsSync(resultPath), {
      timeout: 110_000,
      interval: 100,
      timeoutMsg: "single Mermaid SVG export did not finish",
    });
    const result = JSON.parse(
      readFileSync(resultPath, "utf8"),
    ) as ExportHookResult;
    expect(result).toEqual({
      ok: true,
      fileName: path.basename(outputPath),
    });
    const svg = readFileSync(outputPath, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("```");
  });
});
