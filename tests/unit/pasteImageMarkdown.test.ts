import { describe, expect, it } from "vitest";
import {
  buildMarkdownImageSyntax,
  buildPastedImageRelativePath,
  extractClipboardImageFile,
  extensionForImageMime,
  readFileBytesLimited,
} from "@/editor/pasteImageMarkdown";

describe("pasteImageMarkdown", () => {
  it("maps supported mime types to extensions", () => {
    expect(extensionForImageMime("image/png")).toBe("png");
    expect(extensionForImageMime("image/jpeg")).toBe("jpg");
    expect(extensionForImageMime("image/svg+xml")).toBeNull();
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

  it("extracts the first supported clipboard image", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "a.png", {
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
    } as unknown as DataTransfer;
    expect(extractClipboardImageFile(clipboardData)).toBe(png);
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
