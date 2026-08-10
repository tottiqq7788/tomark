import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pickExportPath = vi.fn();
const writeHtmlAssetBundle = vi.fn();
const writeExportBytes = vi.fn();

vi.mock("@/native/exportFileService", () => ({
  pickExportPath: (...args: unknown[]) => pickExportPath(...args),
  writeHtmlAssetBundle: (...args: unknown[]) => writeHtmlAssetBundle(...args),
  writeExportBytes: (...args: unknown[]) => writeExportBytes(...args),
}));

vi.mock("html2canvas", () => ({
  default: vi.fn(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    const pngBytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (c) => c.charCodeAt(0),
    );
    canvas.toBlob = (cb: BlobCallback) => {
      cb(new Blob([pngBytes], { type: "image/png" }));
    };
    return canvas;
  }),
}));

const originalImageDecode = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "decode",
);

describe("runExport generators", () => {
  beforeEach(async () => {
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    pickExportPath.mockReset();
    writeHtmlAssetBundle.mockReset();
    writeExportBytes.mockReset();
    pickExportPath.mockResolvedValue("/tmp/out.html");
    writeExportBytes.mockResolvedValue(undefined);
    vi.resetModules();
  });

  afterEach(() => {
    if (originalImageDecode) {
      Object.defineProperty(
        HTMLImageElement.prototype,
        "decode",
        originalImageDecode,
      );
    } else {
      delete (HTMLImageElement.prototype as { decode?: unknown }).decode;
    }
  });

  it("exports embedded html bytes", async () => {
    pickExportPath.mockResolvedValue("/tmp/note.html");
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "html-embedded",
      markdownSource: "# 你好\n\n正文",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.fileName).toBe("note.html");
    expect(pickExportPath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "note.html",
        filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      }),
    );
    expect(writeExportBytes).toHaveBeenCalledOnce();
    expect(writeExportBytes.mock.calls[0][0]).toBe("/tmp/note.html");
    const bytes = writeExportBytes.mock.calls[0][1] as Uint8Array;
    const html = new TextDecoder().decode(bytes);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("你好");
    expect(html).toContain("Source Code Pro");
    expect(html).not.toContain("data-source-line");
  });

  it("writes html asset bundles with rewritten relative images", async () => {
    pickExportPath.mockResolvedValue("/tmp/renamed.html");
    writeHtmlAssetBundle.mockResolvedValue(undefined);
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "html-assets",
      markdownSource:
        "![x](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.path).toBe("/tmp/renamed.html");
    expect(writeHtmlAssetBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlPath: "/tmp/renamed.html",
        assetsDirName: "renamed_files",
      }),
    );
    const htmlContent = writeHtmlAssetBundle.mock.calls[0][0].htmlContent as string;
    expect(htmlContent).toContain('src="renamed_files/');
  });

  it("treats cancelled asset html path as cancel", async () => {
    pickExportPath.mockResolvedValue(null);
    const { runExport } = await import("@/export/runExport");
    await expect(
      runExport({
        format: "html-assets",
        markdownSource: "# a",
        documentPath: null,
        fileName: "a.md",
      }),
    ).rejects.toThrow(/已取消导出/);
  });

  it("exports png bytes", async () => {
    pickExportPath.mockResolvedValue("/tmp/note.png");
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "png",
      markdownSource: "# PNG\n\n长图",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.fileName).toBe("note.png");
    expect(pickExportPath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "note.png",
        filters: [{ name: "PNG", extensions: ["png"] }],
      }),
    );
    expect(writeExportBytes).toHaveBeenCalledWith(
      "/tmp/note.png",
      expect.any(Uint8Array),
    );
  });

  it("exports a single-page long-image pdf from the png raster", async () => {
    pickExportPath.mockResolvedValue("/tmp/note.pdf");
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "pdf",
      markdownSource: "# PDF\n\n长图",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.fileName).toBe("note.pdf");
    expect(result.note).toMatch(/不可检索文字/);
    expect(pickExportPath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "note.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      }),
    );
    expect(writeExportBytes).toHaveBeenCalledWith(
      "/tmp/note.pdf",
      expect.any(Uint8Array),
    );
    const bytes = writeExportBytes.mock.calls[0][1] as Uint8Array;
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe(
      "%PDF",
    );
  });

  it("downscales huge png pages below the old 0.5 floor", async () => {
    const { computeExportPngScale } = await import("@/export/runExport");
    const scale = computeExportPngScale(920, 20_000);
    expect(scale).toBeLessThanOrEqual(0.5);
    expect(scale).toBeGreaterThanOrEqual(0.125);
    expect(920 * scale).toBeLessThanOrEqual(8192);
    expect(20_000 * scale).toBeLessThanOrEqual(8192);
  });

  it("rejects png when even minimum scale exceeds canvas limits", async () => {
    const { computeExportPngScale } = await import("@/export/runExport");
    expect(() => computeExportPngScale(920, 1_000_000)).toThrow(
      /无法在画布限制内导出 PNG/,
    );
  });

  it("preloads the png and pdf renderers", async () => {
    const { preloadExportRenderer } = await import("@/export/runExport");
    await expect(preloadExportRenderer("png")).resolves.toBeUndefined();
    await expect(preloadExportRenderer("pdf")).resolves.toBeUndefined();
  });
});
