import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeTauri = vi.fn();
const assertTauriIpcReady = vi.fn();

vi.mock("@/native/tauriRuntime", () => ({
  invokeTauri: (...args: unknown[]) => invokeTauri(...args),
  assertTauriIpcReady: (...args: unknown[]) => assertTauriIpcReady(...args),
}));

import { writeRelativeImage } from "@/native/documentAssetService";

describe("documentAssetService", () => {
  beforeEach(() => {
    invokeTauri.mockReset();
    assertTauriIpcReady.mockReset();
  });

  it("invokes write_document_relative_image with base64 payload", async () => {
    invokeTauri.mockResolvedValue("assets/pasted.png");
    const written = await writeRelativeImage(
      "/tmp/note.md",
      "assets/pasted.png",
      new Uint8Array([1, 2, 3]),
    );
    expect(written).toBe("assets/pasted.png");
    expect(assertTauriIpcReady).toHaveBeenCalled();
    expect(invokeTauri).toHaveBeenCalledWith("write_document_relative_image", {
      documentPath: "/tmp/note.md",
      relativePath: "assets/pasted.png",
      contentsBase64: btoa("\u0001\u0002\u0003"),
    });
  });
});
