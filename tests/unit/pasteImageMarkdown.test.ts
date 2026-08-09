import { describe, expect, it, vi } from "vitest";
import {
  buildMarkdownImageSyntax,
  buildPastedImageRelativePath,
  extractAsyncClipboardImageFile,
  extractClipboardImageFile,
  extensionForImageMime,
  readFileBytesLimited,
  shouldAttemptImagePasteFallbacks,
  shouldSkipAsyncClipboardFallback,
  sniffImageMimeFromBytes,
} from "@/editor/pasteImageMarkdown";

function pngHeader(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
}

describe("pasteImageMarkdown", () => {
  it("maps supported mime types to extensions", () => {
    expect(extensionForImageMime("image/png")).toBe("png");
    expect(extensionForImageMime("image/jpeg")).toBe("jpg");
    expect(extensionForImageMime("image/svg+xml")).toBeNull();
  });

  it("sniffs common image magic headers", () => {
    expect(sniffImageMimeFromBytes(pngHeader())).toBe("image/png");
    expect(sniffImageMimeFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(sniffImageMimeFromBytes(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("builds assets relative paths and markdown syntax", () => {
    const relative = buildPastedImageRelativePath(
      "image/png",
      new Date(2026, 7, 10, 1, 2, 3),
      "abc123",
    );
    expect(relative).toBe("assets/pasted-20260810-010203-abc123.png");
    expect(buildMarkdownImageSyntax(relative)).toBe(
      "![](assets/pasted-20260810-010203-abc123.png)",
    );
  });

  it("extracts the first supported clipboard image", async () => {
    const png = new File([pngHeader()], "a.png", {
      type: "image/png",
    });
    const items = [
      {
        kind: "string",
        type: "text/plain",
        getAsFile: () => null,
      },
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => png,
      },
    ];
    const clipboardData = {
      items,
      files: [] as unknown as FileList,
      types: ["text/plain", "Files"],
      getData: () => "",
    } as unknown as DataTransfer;
    await expect(extractClipboardImageFile(clipboardData)).resolves.toBe(png);
  });

  it("accepts empty MIME when file header is PNG", async () => {
    const raw = new File([pngHeader()], "shot", { type: "" });
    const clipboardData = {
      items: [
        {
          kind: "file",
          type: "",
          getAsFile: () => raw,
        },
      ],
      files: [] as unknown as FileList,
      types: ["Files"],
      getData: () => "",
    } as unknown as DataTransfer;
    const file = await extractClipboardImageFile(clipboardData);
    expect(file?.type).toBe("image/png");
  });

  it("treats WKWebView screenshot-like types without files as fallback candidates", () => {
    const clipboardData = {
      items: [] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
      types: ["image/png", "public.tiff"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(shouldAttemptImagePasteFallbacks(clipboardData)).toBe(true);
    expect(shouldSkipAsyncClipboardFallback(clipboardData)).toBe(true);
  });

  it("does not skip async clipboard when a File item is present", () => {
    const png = new File([pngHeader()], "a.png", { type: "image/png" });
    const clipboardData = {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => png,
        },
      ],
      files: [] as unknown as FileList,
      types: ["Files", "image/png"],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(shouldSkipAsyncClipboardFallback(clipboardData)).toBe(false);
  });

  it("treats completely empty paste payload as fallback candidate", () => {
    const clipboardData = {
      items: [] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
      types: [],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(shouldAttemptImagePasteFallbacks(clipboardData)).toBe(true);
  });

  it("does not attempt image fallbacks for plain text paste", () => {
    const clipboardData = {
      items: [] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? "hello" : ""),
    } as unknown as DataTransfer;
    expect(shouldAttemptImagePasteFallbacks(clipboardData)).toBe(false);
  });

  it("reads PNG via async clipboard API", async () => {
    const blob = new Blob([pngHeader()], { type: "image/png" });
    const clipboard = {
      read: vi.fn(async () => [
        {
          types: ["image/png"],
          getType: async () => blob,
        },
      ]),
    } as unknown as Clipboard;
    const file = await extractAsyncClipboardImageFile(clipboard);
    expect(file?.type).toBe("image/png");
    expect(clipboard.read).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized files before reading", async () => {
    const big = new File([new Uint8Array(16)], "big.png", {
      type: "image/png",
    });
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    await expect(readFileBytesLimited(big, 8 * 1024 * 1024)).rejects.toThrow(
      "图片超过大小限制",
    );
  });
});
