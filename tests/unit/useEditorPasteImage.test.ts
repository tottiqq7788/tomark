import { beforeEach, describe, expect, it, vi } from "vitest";

const writeRelativeImage = vi.fn();

vi.mock("@/native/documentAssetService", () => ({
  writeRelativeImage: (...args: unknown[]) => writeRelativeImage(...args),
}));

import { createEditorPasteImageHandler } from "@/app/useEditorPasteImage";

describe("useEditorPasteImage", () => {
  beforeEach(() => {
    writeRelativeImage.mockReset();
  });

  it("does nothing when saveAs is cancelled", async () => {
    const showError = vi.fn();
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => null,
      ensureDocumentSaved: async () => false,
      showError,
    });
    const dispatch = vi.fn();
    await handler(new File([new Uint8Array([1])], "a.png", { type: "image/png" }), {
      state: { selection: { main: { from: 0, to: 0 } } },
      dispatch,
      focus: vi.fn(),
    } as never);
    expect(writeRelativeImage).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it("writes relative image and inserts markdown after save", async () => {
    let path: string | null = null;
    writeRelativeImage.mockResolvedValue("assets/pasted-demo.png");
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => path,
      ensureDocumentSaved: async () => {
        path = "/tmp/note.md";
        return true;
      },
      showError: vi.fn(),
    });
    const dispatch = vi.fn();
    const focus = vi.fn();
    await handler(new File([new Uint8Array([9, 8, 7])], "a.png", { type: "image/png" }), {
      state: { selection: { main: { from: 2, to: 2 } } },
      dispatch,
      focus,
    } as never);

    expect(writeRelativeImage).toHaveBeenCalledWith(
      "/tmp/note.md",
      expect.stringMatching(/^assets\/pasted-.+\.png$/),
      expect.any(Uint8Array),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: {
          from: 2,
          to: 2,
          insert: "![](assets/pasted-demo.png)",
        },
      }),
    );
    expect(focus).toHaveBeenCalled();
  });

  it("does not insert when write fails", async () => {
    writeRelativeImage.mockRejectedValue(new Error("disk full"));
    const showError = vi.fn();
    const dispatch = vi.fn();
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => "/tmp/note.md",
      ensureDocumentSaved: async () => true,
      showError,
    });
    await handler(new File([new Uint8Array([1])], "a.png", { type: "image/png" }), {
      state: { selection: { main: { from: 0, to: 0 } } },
      dispatch,
      focus: vi.fn(),
    } as never);
    expect(dispatch).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("粘贴图片失败", expect.any(Error));
  });
});
