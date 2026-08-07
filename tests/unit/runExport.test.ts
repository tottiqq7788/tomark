import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pickExportPath = vi.fn();
const writeHtmlAssetBundle = vi.fn();
const writeExportBytes = vi.fn();

vi.mock("@/native/exportFileService", () => ({
  pickExportPath: (...args: unknown[]) => pickExportPath(...args),
  writeHtmlAssetBundle: (...args: unknown[]) => writeHtmlAssetBundle(...args),
  writeExportBytes: (...args: unknown[]) => writeExportBytes(...args),
}));

const createRenderer = vi.fn();
const renderMock = vi.fn();
const disposeRenderer = vi.fn();
const disposePdf = vi.fn();

vi.mock("@imggion/html2realpdf", () => ({
  createRenderer: (...args: unknown[]) => createRenderer(...args),
}));

vi.mock("@turbodocx/html-to-docx", () => ({
  default: vi.fn(async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
}));

vi.mock("html2canvas", () => ({
  default: vi.fn(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    canvas.toBlob = (cb: BlobCallback) => {
      cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
    };
    return canvas;
  }),
}));

const fontsDir = path.join(process.cwd(), "src/assets/fonts");
const fontFiles: Record<string, ArrayBuffer> = {
  "SourceCodePro-Regular.ttf": toArrayBuffer("SourceCodePro-Regular.ttf"),
  "SourceCodePro-Bold.ttf": toArrayBuffer("SourceCodePro-Bold.ttf"),
  "SourceHanSansSC-VF.ttf": toArrayBuffer("SourceHanSansSC-VF.ttf"),
  "NotoSansSymbols2-Regular.ttf": toArrayBuffer("NotoSansSymbols2-Regular.ttf"),
  "NotoEmoji-Regular.ttf": toArrayBuffer("NotoEmoji-Regular.ttf"),
};

function toArrayBuffer(name: string): ArrayBuffer {
  const bytes = readFileSync(path.join(fontsDir, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function installFontFetchMock() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = String(input);
    const fileName = Object.keys(fontFiles).find((name) => href.includes(name));
    if (!fileName) {
      return new Response(null, { status: 404 });
    }
    return new Response(fontFiles[fileName], { status: 200 });
  }) as typeof fetch;
}

describe("runExport generators", () => {
  beforeEach(async () => {
    pickExportPath.mockReset();
    writeHtmlAssetBundle.mockReset();
    writeExportBytes.mockReset();
    createRenderer.mockReset();
    renderMock.mockReset();
    disposeRenderer.mockReset();
    disposePdf.mockReset();
    pickExportPath.mockResolvedValue("/tmp/out.pdf");
    writeExportBytes.mockResolvedValue(undefined);
    createRenderer.mockImplementation(async () => ({
      render: renderMock,
      dispose: disposeRenderer,
    }));
    installFontFetchMock();
    vi.resetModules();
    const mod = await import("@/export/runExport");
    mod.resetExportFontCache();
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
    pickExportPath.mockResolvedValue("/tmp/note.html");
    writeHtmlAssetBundle.mockResolvedValue(undefined);
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "html-assets",
      markdownSource:
        "![x](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.path).toBe("/tmp/note.html");
    expect(writeHtmlAssetBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlPath: "/tmp/note.html",
        assetsDirName: "note_files",
      }),
    );
    const htmlContent = writeHtmlAssetBundle.mock.calls[0][0].htmlContent as string;
    expect(htmlContent).toContain('src="note_files/');
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

  it("renders a single-page PDF with wasmUrl and ordered font fallbacks", async () => {
    renderMock.mockResolvedValue({
      pageCount: 1,
      toUint8Array: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      dispose: disposePdf,
    });

    const { runExport, resolvePdfWasmUrl } = await import("@/export/runExport");
    const result = await runExport({
      format: "pdf",
      markdownSource: "# 中文标题\n\n可搜索 `中文代码` 😀🚀⚙️",
      documentPath: null,
      fileName: "中文.md",
    });
    expect(result.fileName).toBe("out.pdf");
    expect(createRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        wasmUrl: resolvePdfWasmUrl(),
        execution: "main",
      }),
    );
    const fonts = createRenderer.mock.calls[0][0].fonts as { family: string }[];
    expect(fonts.map((font) => font.family)).toEqual([
      "Source Code Pro",
      "Source Code Pro",
      "Source Han Sans SC",
      "Source Han Sans SC",
      "Noto Sans Symbols 2",
      "Noto Emoji",
    ]);
    expect(resolvePdfWasmUrl()).toContain("libhtml2realpdf.wasm");
    expect(resolvePdfWasmUrl()).not.toContain("@fs");
    expect(renderMock).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        page: expect.objectContaining({
          unit: "px",
          margin: 0,
        }),
      }),
    );
    const page = renderMock.mock.calls[0][1].page;
    expect(page.format[0]).toBeGreaterThan(0);
    expect(page.format[1]).toBeGreaterThan(0);
    expect(disposePdf).toHaveBeenCalled();
    expect(disposeRenderer).toHaveBeenCalled();
  });

  it("renders a multi-page A4 vector PDF with page-break protection", async () => {
    pickExportPath.mockResolvedValue("/tmp/note-分页.pdf");
    renderMock.mockResolvedValue({
      pageCount: 3,
      toUint8Array: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      dispose: disposePdf,
    });

    const { runExport, resolvePdfWasmUrl } = await import("@/export/runExport");
    const result = await runExport({
      format: "pdf-paged",
      markdownSource:
        "# 分页\n\n![x](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)\n\n图注\n",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.fileName).toBe("note-分页.pdf");
    expect(result.note).toMatch(/共 3 页/);
    expect(createRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        wasmUrl: resolvePdfWasmUrl(),
      }),
    );
    expect(renderMock).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        mediaType: "print",
        layoutContext: "page",
        fallback: "error",
        page: expect.objectContaining({
          format: "a4",
          orientation: "portrait",
          unit: "mm",
          margin: [12, 13, 12, 13],
        }),
        pageBreak: expect.objectContaining({
          avoid: expect.arrayContaining([".pdf-atomic", "thead", "tr"]),
          legacy: false,
        }),
      }),
    );
    const article = renderMock.mock.calls[0][0] as HTMLElement;
    expect(article.classList.contains("export-root-paged")).toBe(true);
    expect(pickExportPath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "note-分页.pdf",
      }),
    );
    expect(writeExportBytes).toHaveBeenCalledWith(
      "/tmp/note-分页.pdf",
      expect.any(Uint8Array),
    );
  });

  it("refuses multi-page PDF without bitmap fallback", async () => {
    renderMock.mockResolvedValue({
      pageCount: 2,
      toUint8Array: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      dispose: disposePdf,
    });

    const { runExport } = await import("@/export/runExport");
    await expect(
      runExport({
        format: "pdf",
        markdownSource: "# x",
        documentPath: null,
        fileName: "x.md",
      }),
    ).rejects.toThrow(/单页长页/);
    expect(writeExportBytes).not.toHaveBeenCalled();
  });

  it("preflights uncovered glyphs with U+XXXX before rendering", async () => {
    const { runExport } = await import("@/export/runExport");
    await expect(
      runExport({
        format: "pdf",
        markdownSource: "# rare\n\n𒀀",
        documentPath: null,
        fileName: "rare.md",
      }),
    ).rejects.toThrow(/U\+/);
    expect(createRenderer).not.toHaveBeenCalled();
  });

  it("exports docx bytes", async () => {
    pickExportPath.mockResolvedValue("/tmp/note.docx");
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "docx",
      markdownSource: "# Word\n\n正文",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.fileName).toBe("note.docx");
    expect(pickExportPath).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "note.docx",
        filters: [{ name: "Word", extensions: ["docx"] }],
      }),
    );
    expect(writeExportBytes).toHaveBeenCalledWith(
      "/tmp/note.docx",
      expect.any(Uint8Array),
    );
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
    expect(() => computeExportPngScale(920, 1_000_000)).toThrow(/无法在画布限制内导出 PNG/);
  });
});
