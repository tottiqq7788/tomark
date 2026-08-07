import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportCancelledError } from "@/export/types";

const saveBytesWithDialog = vi.fn();
const pickExportPath = vi.fn();
const writeHtmlAssetBundle = vi.fn();

vi.mock("@/native/exportFileService", () => ({
  saveBytesWithDialog: (...args: unknown[]) => saveBytesWithDialog(...args),
  pickExportPath: (...args: unknown[]) => pickExportPath(...args),
  writeHtmlAssetBundle: (...args: unknown[]) => writeHtmlAssetBundle(...args),
}));

const renderMock = vi.fn();
const disposeRenderer = vi.fn();
const disposePdf = vi.fn();

vi.mock("@imggion/html2realpdf", () => ({
  createRenderer: vi.fn(async () => ({
    render: renderMock,
    dispose: disposeRenderer,
  })),
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

describe("runExport generators", () => {
  beforeEach(() => {
    saveBytesWithDialog.mockReset();
    pickExportPath.mockReset();
    writeHtmlAssetBundle.mockReset();
    renderMock.mockReset();
    disposeRenderer.mockReset();
    disposePdf.mockReset();
    saveBytesWithDialog.mockResolvedValue({
      path: "/tmp/out.pdf",
      fileName: "out.pdf",
    });
  });

  it("exports embedded html bytes", async () => {
    saveBytesWithDialog.mockResolvedValue({
      path: "/tmp/note.html",
      fileName: "note.html",
    });
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "html-embedded",
      markdownSource: "# 你好\n\n正文",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.fileName).toBe("note.html");
    expect(saveBytesWithDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "note.html",
        filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      }),
    );
    const bytes = saveBytesWithDialog.mock.calls[0][0].bytes as Uint8Array;
    const html = new TextDecoder().decode(bytes);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("你好");
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
    ).rejects.toBeInstanceOf(ExportCancelledError);
  });

  it("renders a single-page PDF with custom long-page size", async () => {
    renderMock.mockResolvedValue({
      pageCount: 1,
      toUint8Array: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      dispose: disposePdf,
    });
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array([0, 1, 2, 3]).buffer, { status: 200 }),
    ) as typeof fetch;

    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "pdf",
      markdownSource: "# 中文标题\n\n可搜索",
      documentPath: null,
      fileName: "中文.md",
    });
    expect(result.fileName).toBe("out.pdf");
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

  it("refuses multi-page PDF without bitmap fallback", async () => {
    renderMock.mockResolvedValue({
      pageCount: 2,
      toUint8Array: () => new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      dispose: disposePdf,
    });
    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array([0, 1, 2, 3]).buffer, { status: 200 }),
    ) as typeof fetch;

    const { runExport } = await import("@/export/runExport");
    await expect(
      runExport({
        format: "pdf",
        markdownSource: "# x",
        documentPath: null,
        fileName: "x.md",
      }),
    ).rejects.toThrow(/单页长页/);
    expect(saveBytesWithDialog).not.toHaveBeenCalled();
  });

  it("exports docx bytes", async () => {
    saveBytesWithDialog.mockResolvedValue({
      path: "/tmp/note.docx",
      fileName: "note.docx",
    });
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "docx",
      markdownSource: "# Word\n\n正文",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.fileName).toBe("note.docx");
    expect(saveBytesWithDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "note.docx",
        filters: [{ name: "Word", extensions: ["docx"] }],
      }),
    );
  });

  it("exports png bytes", async () => {
    saveBytesWithDialog.mockResolvedValue({
      path: "/tmp/note.png",
      fileName: "note.png",
    });
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format: "png",
      markdownSource: "# PNG\n\n长图",
      documentPath: null,
      fileName: "note.md",
    });
    expect(result.fileName).toBe("note.png");
    expect(saveBytesWithDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "note.png",
        filters: [{ name: "PNG", extensions: ["png"] }],
      }),
    );
  });
});
