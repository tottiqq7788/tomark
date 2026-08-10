import { beforeEach, describe, expect, it, vi } from "vitest";

const html2canvas = vi.fn();
const saveBytesWithDialog = vi.fn();
const writeExportBytes = vi.fn();
const renderMermaidSvg = vi.fn();

vi.mock("html2canvas-pro", () => ({
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
  copyMermaidDiagramPngToClipboard,
  cropCanvasWhiteMargins,
  exportMermaidDiagramPng,
  PNG_SCALE,
  rasterizeMermaidDiagramPng,
  suggestMermaidPngName,
  tightenMermaidSvgToContent,
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

  it("writes a PNG ClipboardItem via Web Clipboard", async () => {
    class FakeClipboardItem {
      readonly types: string[];
      constructor(items: Record<string, Blob | Promise<Blob>>) {
        this.types = Object.keys(items);
      }
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    const result = await copyMermaidDiagramPngToClipboard("graph TD\nA-->B");
    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(write).toHaveBeenCalledTimes(1);
    const items = write.mock.calls[0][0] as Array<{ types: string[] }>;
    expect(items).toHaveLength(1);
    expect(items[0].types).toContain("image/png");
    vi.unstubAllGlobals();
  });

  it("fails closed when ClipboardItem write is unavailable", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn() },
    });
    await expect(
      copyMermaidDiagramPngToClipboard("graph TD\nA-->B"),
    ).rejects.toMatchObject({
      name: "ExportFailedError",
      message: expect.stringContaining("不支持复制图片"),
    });
    vi.unstubAllGlobals();
  });

  it("tightens SVG viewBox to getBBox content plus pad", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 200 300");
    svg.setAttribute("width", "200");
    svg.setAttribute("height", "300");
    svg.getBBox = () =>
      ({
        x: 10,
        y: 20,
        width: 80,
        height: 60,
        top: 20,
        left: 10,
        right: 90,
        bottom: 80,
        toJSON: () => ({}),
      }) as DOMRect;
    const size = tightenMermaidSvgToContent(svg, 8);
    expect(size).toEqual({ width: 96, height: 76 });
    expect(svg.getAttribute("viewBox")).toBe("2 12 96 76");
    expect(svg.getAttribute("width")).toBe("96");
    expect(svg.getAttribute("height")).toBe("76");
  });

  it("crops near-white margins from a raster canvas", () => {
    const width = 40;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
    // Opaque dark content at (5,5)-(14,12)
    for (let y = 5; y < 13; y += 1) {
      for (let x = 5; x < 15; x += 1) {
        const i = (y * width + x) * 4;
        data[i] = 51;
        data[i + 1] = 51;
        data[i + 2] = 51;
      }
    }
    const drawImage = vi.fn();
    const outCanvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: "",
        fillRect: vi.fn(),
        drawImage,
      }),
    };
    const createElement = vi
      .spyOn(document, "createElement")
      .mockReturnValue(outCanvas as unknown as HTMLCanvasElement);
    const canvas = {
      width,
      height,
      getContext: () => ({
        getImageData: () => ({ data, width, height }),
      }),
    } as unknown as HTMLCanvasElement;

    const cropped = cropCanvasWhiteMargins(canvas, 2);
    expect(cropped).toBe(outCanvas);
    expect(outCanvas.width).toBe(14);
    expect(outCanvas.height).toBe(12);
    expect(drawImage).toHaveBeenCalledWith(canvas, 3, 3, 14, 12, 0, 0, 14, 12);
    createElement.mockRestore();
  });
});
