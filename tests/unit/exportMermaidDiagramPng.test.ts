import { beforeEach, describe, expect, it, vi } from "vitest";

const html2canvas = vi.fn();
const saveBytesWithDialog = vi.fn();
const writeExportBytes = vi.fn();
const renderMermaidSvg = vi.fn();

vi.mock("html2canvas", () => ({
  default: (...args: unknown[]) => html2canvas(...args),
}));

vi.mock("@/preview/renderMermaid", () => ({
  renderMermaidSvg: (...args: unknown[]) => renderMermaidSvg(...args),
}));

vi.mock("@/native/exportFileService", () => ({
  saveBytesWithDialog: (...args: unknown[]) => saveBytesWithDialog(...args),
  writeExportBytes: (...args: unknown[]) => writeExportBytes(...args),
}));

import {
  exportMermaidDiagramPng,
  PNG_SCALE,
  rasterizeMermaidDiagramPng,
  suggestMermaidPngName,
} from "@/export/exportMermaidDiagramPng";

describe("exportMermaidDiagramPng", () => {
  beforeEach(() => {
    html2canvas.mockReset();
    saveBytesWithDialog.mockReset();
    writeExportBytes.mockReset();
    renderMermaidSvg.mockReset();
    renderMermaidSvg.mockResolvedValue(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><rect width="100" height="50"/></svg>`,
    );
    html2canvas.mockImplementation(async () => ({
      width: 200,
      height: 100,
      toBlob: (cb: (blob: Blob | null) => void) => {
        cb(
          new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
            type: "image/png",
          }),
        );
      },
    }));
    writeExportBytes.mockResolvedValue(undefined);
    saveBytesWithDialog.mockResolvedValue({
      path: "/tmp/demo-mermaid-1.png",
      fileName: "demo-mermaid-1.png",
    });
  });

  it("suggests document-scoped default names", () => {
    expect(suggestMermaidPngName("notes.md", 2)).toBe("notes-mermaid-2.png");
    expect(PNG_SCALE).toBe(2);
  });

  it("rasterizes with white background and fixed 2× scale", async () => {
    const result = await rasterizeMermaidDiagramPng("graph TD\nA-->B");
    expect(html2canvas).toHaveBeenCalled();
    const options = html2canvas.mock.calls[0][1];
    expect(options.backgroundColor).toBe("#ffffff");
    expect(options.scale).toBe(2);
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(result.bytes[0]).toBe(0x89);
  });

  it("writes through targetPath without opening a dialog", async () => {
    const result = await exportMermaidDiagramPng({
      source: "graph TD\nA-->B",
      fileName: "demo.md",
      diagramIndex: 1,
      targetPath: "/tmp/forced.png",
    });
    expect(writeExportBytes).toHaveBeenCalled();
    expect(saveBytesWithDialog).not.toHaveBeenCalled();
    expect(result.path).toBe("/tmp/forced.png");
  });

  it("maps cancel to ExportCancelledError when dialog returns null path", async () => {
    const { ExportCancelledError } = await import("@/export/types");
    saveBytesWithDialog.mockRejectedValue(new ExportCancelledError());
    await expect(
      exportMermaidDiagramPng({
        source: "graph TD\nA-->B",
        fileName: "demo.md",
      }),
    ).rejects.toMatchObject({ name: "ExportCancelledError" });
  });

  it("fails closed when the 2× canvas would exceed WebKit limits", async () => {
    renderMermaidSvg.mockResolvedValue(
      `<svg xmlns="http://www.w3.org/2000/svg" width="9000" height="9000" viewBox="0 0 9000 9000"></svg>`,
    );
    await expect(rasterizeMermaidDiagramPng("graph TD\nA-->B")).rejects.toMatchObject({
      name: "ExportFailedError",
      message: expect.stringContaining("画布限制"),
    });
    expect(html2canvas).not.toHaveBeenCalled();
  });
});
