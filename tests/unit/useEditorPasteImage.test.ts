import { beforeEach, describe, expect, it, vi } from "vitest";

const writeRelativeImage = vi.fn();
const readNativeClipboardPng = vi.fn();

vi.mock("@/native/documentAssetService", () => ({
  writeRelativeImage: (...args: unknown[]) => writeRelativeImage(...args),
}));

vi.mock("@/native/clipboardImageService", () => ({
  readNativeClipboardPng: (...args: unknown[]) => readNativeClipboardPng(...args),
}));

import { createEditorPasteImageHandler } from "@/app/useEditorPasteImage";

function pngFile(): File {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
    "a.png",
    { type: "image/png" },
  );
}

function fileClipboard(file: File): DataTransfer {
  return {
    items: [
      {
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      },
    ],
    files: {
      length: 1,
      0: file,
      item: (index: number) => (index === 0 ? file : null),
    },
    types: ["Files", file.type],
    getData: () => "",
  } as unknown as DataTransfer;
}

function screenshotClipboard(): DataTransfer {
  return {
    items: [] as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
    types: ["image/png", "public.tiff"],
    getData: () => "",
  } as unknown as DataTransfer;
}

function textClipboard(text: string): DataTransfer {
  return {
    items: [] as unknown as DataTransferItemList,
    files: [] as unknown as FileList,
    types: ["text/plain"],
    getData: (type: string) => (type === "text/plain" ? text : ""),
  } as unknown as DataTransfer;
}

describe("useEditorPasteImage", () => {
  beforeEach(() => {
    writeRelativeImage.mockReset();
    readNativeClipboardPng.mockReset();
  });

  it("shows error and does not write when saveAs is cancelled", async () => {
    const showError = vi.fn();
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => null,
      ensureDocumentSaved: async () => false,
      showError,
    });
    const dispatch = vi.fn();
    const handled = await handler(fileClipboard(pngFile()), {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch,
      focus: vi.fn(),
    } as never);
    expect(handled).toBe(true);
    expect(writeRelativeImage).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith(
      "粘贴图片失败",
      expect.any(Error),
    );
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
    await handler(fileClipboard(pngFile()), {
      state: {
        selection: { main: { from: 2, to: 2 } },
        doc: { length: 10 },
      },
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
    await handler(fileClipboard(pngFile()), {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch,
      focus: vi.fn(),
    } as never);
    expect(dispatch).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("粘贴图片失败", expect.any(Error));
  });

  it("falls back to native read-image for screenshot-like clipboard", async () => {
    writeRelativeImage.mockResolvedValue("assets/pasted-native.png");
    readNativeClipboardPng.mockResolvedValue({
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mime: "image/png",
      fileName: "clipboard.png",
    });
    const readAsyncClipboardImage = vi.fn(async () => null);
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => "/tmp/note.md",
      ensureDocumentSaved: async () => true,
      showError: vi.fn(),
      readAsyncClipboardImage,
    });
    const dispatch = vi.fn();
    await handler(screenshotClipboard(), {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch,
      focus: vi.fn(),
    } as never);
    // Screenshot-like payloads skip Async Clipboard to avoid WKWebView hangs.
    expect(readAsyncClipboardImage).not.toHaveBeenCalled();
    expect(readNativeClipboardPng).toHaveBeenCalledTimes(1);
    expect(writeRelativeImage).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalled();
  });

  it("does not call native clipboard for plain text paste", async () => {
    const readAsyncClipboardImage = vi.fn(async () => null);
    const readNativeClipboardImage = vi.fn(async () => pngFile());
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => "/tmp/note.md",
      ensureDocumentSaved: async () => true,
      showError: vi.fn(),
      readAsyncClipboardImage,
      readNativeClipboardImage,
    });
    const handled = await handler(textClipboard("hello"), {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
    } as never);
    expect(handled).toBe(false);
    expect(readAsyncClipboardImage).not.toHaveBeenCalled();
    expect(readNativeClipboardImage).not.toHaveBeenCalled();
    expect(writeRelativeImage).not.toHaveBeenCalled();
  });

  it("shows a visible error when a second paste arrives while one is in flight", async () => {
    let releaseNative: ((file: File) => void) | undefined;
    const pendingNative = new Promise<File>((resolve) => {
      releaseNative = resolve;
    });
    const showError = vi.fn();
    writeRelativeImage.mockResolvedValue("assets/pasted-demo.png");
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => "/tmp/note.md",
      ensureDocumentSaved: async () => true,
      showError,
      readAsyncClipboardImage: async () => null,
      readNativeClipboardImage: () => pendingNative,
    });
    const view = {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
    } as never;

    const first = handler(screenshotClipboard(), view);
    const second = await handler(screenshotClipboard(), view);
    expect(second).toBe(true);
    expect(showError).toHaveBeenCalledWith(
      "粘贴图片失败",
      expect.objectContaining({ message: expect.stringContaining("正在处理") }),
    );

    releaseNative?.(pngFile());
    await first;
    expect(writeRelativeImage).toHaveBeenCalledTimes(1);
  });

  it("shows error when native clipboard has no image", async () => {
    const showError = vi.fn();
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => "/tmp/note.md",
      ensureDocumentSaved: async () => true,
      showError,
      readAsyncClipboardImage: async () => null,
      readNativeClipboardImage: async () => {
        throw new Error("剪贴板中没有图片");
      },
    });
    const dispatch = vi.fn();
    await handler(screenshotClipboard(), {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch,
      focus: vi.fn(),
    } as never);
    expect(dispatch).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("粘贴图片失败", expect.any(Error));
  });

  it("prefers async clipboard before native fallback for empty payloads", async () => {
    writeRelativeImage.mockResolvedValue("assets/pasted-async.png");
    const asyncFile = pngFile();
    const readNativeClipboardImage = vi.fn(async () => pngFile());
    const emptyClipboard = {
      items: [] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
      types: [],
      getData: () => "",
    } as unknown as DataTransfer;
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => "/tmp/note.md",
      ensureDocumentSaved: async () => true,
      showError: vi.fn(),
      readAsyncClipboardImage: async () => asyncFile,
      readNativeClipboardImage,
    });
    await handler(emptyClipboard, {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
    } as never);
    expect(readNativeClipboardImage).not.toHaveBeenCalled();
    expect(writeRelativeImage).toHaveBeenCalled();
  });

  it("surfaces an error when native clipboard read hangs past timeout", async () => {
    const showError = vi.fn();
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => "/tmp/note.md",
      ensureDocumentSaved: async () => true,
      showError,
      nativeClipboardTimeoutMs: 30,
      readAsyncClipboardImage: async () => null,
      readNativeClipboardImage: () => new Promise(() => undefined),
    });
    const dispatch = vi.fn();
    await handler(screenshotClipboard(), {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch,
      focus: vi.fn(),
    } as never);
    expect(dispatch).not.toHaveBeenCalled();
    expect(writeRelativeImage).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("粘贴图片失败", expect.any(Error));
  });

  it("falls back to native when async clipboard hangs past timeout", async () => {
    writeRelativeImage.mockResolvedValue("assets/pasted-timeout.png");
    const readNativeClipboardImage = vi.fn(async () => pngFile());
    const emptyClipboard = {
      items: [] as unknown as DataTransferItemList,
      files: [] as unknown as FileList,
      types: [],
      getData: () => "",
    } as unknown as DataTransfer;
    const handler = createEditorPasteImageHandler({
      getDocumentPath: () => "/tmp/note.md",
      ensureDocumentSaved: async () => true,
      showError: vi.fn(),
      asyncClipboardTimeoutMs: 30,
      readAsyncClipboardImage: () => new Promise(() => undefined),
      readNativeClipboardImage,
    });
    await handler(emptyClipboard, {
      state: {
        selection: { main: { from: 0, to: 0 } },
        doc: { length: 0 },
      },
      dispatch: vi.fn(),
      focus: vi.fn(),
    } as never);
    expect(readNativeClipboardImage).toHaveBeenCalledTimes(1);
    expect(writeRelativeImage).toHaveBeenCalled();
  });
});
