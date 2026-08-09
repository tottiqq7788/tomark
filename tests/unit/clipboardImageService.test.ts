import { beforeEach, describe, expect, it, vi } from "vitest";

const assertTauriIpcReady = vi.fn();
const readImage = vi.fn();

vi.mock("@/native/tauriRuntime", () => ({
  assertTauriIpcReady: (...args: unknown[]) => assertTauriIpcReady(...args),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readImage: (...args: unknown[]) => readImage(...args),
}));

import {
  encodeRgbaToPngBytes,
  readNativeClipboardPng,
} from "@/native/clipboardImageService";

describe("clipboardImageService", () => {
  beforeEach(() => {
    assertTauriIpcReady.mockReset();
    readImage.mockReset();
  });

  it("encodes RGBA pixels to PNG under the size limit", async () => {
    const rgba = new Uint8Array([255, 0, 0, 255]);
    const originalCreateElement = document.createElement.bind(document);
    const toBlob = vi.fn((cb: BlobCallback) => {
      cb(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
    });
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            putImageData: vi.fn(),
          }),
          toBlob,
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    });

    const bytes = await encodeRgbaToPngBytes(rgba, 1, 1, 1024);
    expect(bytes[0]).toBe(0x89);
    expect(toBlob).toHaveBeenCalled();
  });

  it("rejects encoded PNG above the byte limit", async () => {
    const rgba = new Uint8Array([255, 0, 0, 255]);
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            putImageData: vi.fn(),
          }),
          toBlob: (cb: BlobCallback) => {
            cb(new Blob([new Uint8Array(32)], { type: "image/png" }));
          },
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    });

    await expect(encodeRgbaToPngBytes(rgba, 1, 1, 8)).rejects.toThrow(
      "图片超过大小限制",
    );
  });

  it("reads native clipboard image and closes the resource", async () => {
    const close = vi.fn(async () => undefined);
    readImage.mockResolvedValue({
      size: async () => ({ width: 1, height: 1 }),
      rgba: async () => new Uint8Array([0, 255, 0, 255]),
      close,
    });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            putImageData: vi.fn(),
          }),
          toBlob: (cb: BlobCallback) => {
            cb(
              new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
                type: "image/png",
              }),
            );
          },
        } as unknown as HTMLCanvasElement;
      }
      return originalCreateElement(tag);
    });

    const result = await readNativeClipboardPng();
    expect(assertTauriIpcReady).toHaveBeenCalledWith("读取剪贴板图片");
    expect(result.mime).toBe("image/png");
    expect(result.bytes[0]).toBe(0x89);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes the image resource when encoding fails", async () => {
    const close = vi.fn(async () => undefined);
    readImage.mockResolvedValue({
      size: async () => ({ width: 1, height: 1 }),
      rgba: async () => new Uint8Array([1, 2, 3]),
      close,
    });

    await expect(readNativeClipboardPng()).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
