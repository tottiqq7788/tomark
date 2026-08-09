import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveOneImage = vi.fn();

vi.mock("@/export/resolveImages", () => ({
  resolveOneImage: (...args: unknown[]) => resolveOneImage(...args),
}));

import {
  clearPreviewImageCache,
  resolvePreviewImage,
} from "@/preview/resolvePreviewImage";

describe("resolvePreviewImage", () => {
  beforeEach(() => {
    clearPreviewImageCache();
    resolveOneImage.mockReset();
    resolveOneImage.mockResolvedValue({
      originalSrc: "pic.png",
      dataUrl: "data:image/png;base64,aaa",
      extension: "png",
      bytes: new Uint8Array([1, 2, 3]),
    });
  });

  it("caches resolved images by document path and src", async () => {
    const first = await resolvePreviewImage("pic.png", "/doc/a.md");
    const second = await resolvePreviewImage("pic.png", "/doc/a.md");
    expect(resolveOneImage).toHaveBeenCalledTimes(1);
    expect(first.dataUrl).toBe("data:image/png;base64,aaa");
    expect(second.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("does not share cache across document paths", async () => {
    await resolvePreviewImage("pic.png", "/doc/a.md");
    await resolvePreviewImage("pic.png", "/doc/b.md");
    expect(resolveOneImage).toHaveBeenCalledTimes(2);
  });

  it("surfaces unsaved relative-path failures", async () => {
    resolveOneImage.mockRejectedValue(
      new Error("文档尚未保存，无法读取相对路径本地图片"),
    );
    await expect(resolvePreviewImage("./x.png", null)).rejects.toThrow(
      /尚未保存/,
    );
  });
});
