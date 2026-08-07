import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeTauri = vi.fn();

vi.mock("@/native/tauriRuntime", () => ({
  invokeTauri: (...args: unknown[]) => invokeTauri(...args),
}));

describe("resolveImagesInHtml", () => {
  beforeEach(() => {
    invokeTauri.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes compact base64 image payloads returned by native IPC", async () => {
    invokeTauri.mockResolvedValue({
      contentsBase64: "iVBORw==",
      mimeType: "image/png",
      extension: "png",
    });
    const { resolveImagesInHtml } = await import("@/export/resolveImages");

    const result = await resolveImagesInHtml(
      '<p><img src="images/a.png" alt="a"></p>',
      {
        documentPath: "/notes/demo.md",
        mode: "embed",
        baseName: "demo",
      },
    );

    expect(invokeTauri).toHaveBeenCalledWith("read_export_image", {
      documentPath: "/notes/demo.md",
      relativePath: "images/a.png",
      maxBytes: 8 * 1024 * 1024,
    });
    expect(result.html).toContain(
      'src="data:image/png;base64,iVBORw=="',
    );
    expect(Array.from(result.images[0]?.bytes ?? [])).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("decodes percent-encoded local paths and strips URL query metadata", async () => {
    invokeTauri.mockResolvedValue({
      contentsBase64: "iVBORw==",
      mimeType: "image/png",
      extension: "png",
    });
    const { resolveImagesInHtml } = await import("@/export/resolveImages");

    const result = await resolveImagesInHtml(
      '<img src="images/%E4%B8%AD%E6%96%87%20a.png?x=1&amp;y=2">',
      {
        documentPath: "/notes/demo.md",
        mode: "embed",
        baseName: "demo",
      },
    );

    expect(invokeTauri).toHaveBeenCalledWith("read_export_image", {
      documentPath: "/notes/demo.md",
      relativePath: "images/中文 a.png",
      maxBytes: 8 * 1024 * 1024,
    });
    expect(result.html).toContain(
      'src="data:image/png;base64,iVBORw=="',
    );
  });

  it("times out a remote image instead of leaving export stuck", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          }),
      ),
    );
    const { resolveImagesInHtml } = await import("@/export/resolveImages");

    const pending = resolveImagesInHtml(
      '<img src="https://example.test/slow.png">',
      {
        documentPath: null,
        mode: "embed",
        baseName: "demo",
      },
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await pending;

    expect(result.images).toEqual([]);
    expect(result.warnings).toEqual([
      {
        src: "https://example.test/slow.png",
        reason: "网络图片下载超时（20 秒）",
      },
    ]);
    expect(result.html).not.toContain("<img");
    expect(result.html).toContain("export-image-warning");
  });
});
