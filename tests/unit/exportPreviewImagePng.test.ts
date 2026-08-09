import { beforeEach, describe, expect, it, vi } from "vitest";

const saveBytesWithDialog = vi.fn();
const writeExportBytes = vi.fn();

vi.mock("@/native/exportFileService", () => ({
  saveBytesWithDialog: (...args: unknown[]) => saveBytesWithDialog(...args),
  writeExportBytes: (...args: unknown[]) => writeExportBytes(...args),
}));

import {
  copyPreviewImagePngToClipboard,
  encodePreviewImagePng,
  exportPreviewImagePng,
  suggestPreviewImagePngName,
} from "@/export/exportPreviewImagePng";

describe("exportPreviewImagePng", () => {
  beforeEach(() => {
    saveBytesWithDialog.mockReset();
    writeExportBytes.mockReset();
    writeExportBytes.mockResolvedValue(undefined);
    saveBytesWithDialog.mockResolvedValue({
      path: "/tmp/demo-image-1.png",
      fileName: "demo-image-1.png",
    });
  });

  it("suggests document-scoped default names", () => {
    expect(suggestPreviewImagePngName("notes.md", 2)).toBe("notes-image-2.png");
  });

  it("reuses existing PNG bytes without re-encoding", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 10;
        naturalHeight = 8;
        width = 10;
        height = 8;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const result = await encodePreviewImagePng({
      dataUrl: "data:image/png;base64,aaa",
      bytes,
      mimeType: "image/png",
    });
    expect(result.bytes).toBe(bytes);
    expect(result.width).toBe(10);
    expect(result.height).toBe(8);
    vi.unstubAllGlobals();
  });

  it("writes through targetPath without opening a dialog", async () => {
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 4;
        naturalHeight = 4;
        width = 4;
        height = 4;
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const result = await exportPreviewImagePng({
      dataUrl: "data:image/png;base64,aaa",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
      fileName: "demo.md",
      targetPath: "/tmp/forced.png",
    });
    expect(writeExportBytes).toHaveBeenCalled();
    expect(saveBytesWithDialog).not.toHaveBeenCalled();
    expect(result.path).toBe("/tmp/forced.png");
    vi.unstubAllGlobals();
  });

  it("writes a PNG ClipboardItem via Web Clipboard", async () => {
    class FakeClipboardItem {
      readonly types: string[];
      constructor(items: Record<string, Blob | Promise<Blob>>) {
        this.types = Object.keys(items);
      }
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.stubGlobal(
      "Image",
      class {
        naturalWidth = 2;
        naturalHeight = 2;
        width = 2;
        height = 2;
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    await copyPreviewImagePngToClipboard({
      dataUrl: "data:image/png;base64,aaa",
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
    });
    expect(write).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
