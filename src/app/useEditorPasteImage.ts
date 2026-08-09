import type { EditorView } from "@codemirror/view";
import { writeRelativeImage } from "@/native/documentAssetService";
import { readNativeClipboardPng } from "@/native/clipboardImageService";
import {
  buildMarkdownImageSyntax,
  buildPastedImageRelativePath,
  extractAsyncClipboardImageFile,
  extractClipboardImageFile,
  fileFromPngBytes,
  readFileBytesLimited,
  shouldAttemptImagePasteFallbacks,
  shouldSkipAsyncClipboardFallback,
} from "@/editor/pasteImageMarkdown";

export type EditorPasteImageDeps = {
  getDocumentPath: () => string | null;
  ensureDocumentSaved: () => Promise<boolean>;
  showError: (title: string, error: unknown) => Promise<void> | void;
  readAsyncClipboardImage?: () => Promise<File | null>;
  readNativeClipboardImage?: () => Promise<File>;
  asyncClipboardTimeoutMs?: number;
  nativeClipboardTimeoutMs?: number;
};

const DEFAULT_ASYNC_CLIPBOARD_TIMEOUT_MS = 800;
const DEFAULT_NATIVE_CLIPBOARD_TIMEOUT_MS = 2500;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label}超时`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function resolvePasteImageFile(
  clipboardData: DataTransfer | null | undefined,
  deps: EditorPasteImageDeps,
): Promise<File | null> {
  const syncFile = await extractClipboardImageFile(clipboardData);
  if (syncFile) {
    return syncFile;
  }
  if (!shouldAttemptImagePasteFallbacks(clipboardData)) {
    return null;
  }

  if (!shouldSkipAsyncClipboardFallback(clipboardData)) {
    const readAsync =
      deps.readAsyncClipboardImage
      ?? (() => extractAsyncClipboardImageFile());
    try {
      const asyncFile = await withTimeout(
        readAsync(),
        deps.asyncClipboardTimeoutMs ?? DEFAULT_ASYNC_CLIPBOARD_TIMEOUT_MS,
        "异步剪贴板读取",
      );
      if (asyncFile) {
        return asyncFile;
      }
    } catch {
      // Permission prompts / WKWebView hangs must not block native read-image.
    }
  }

  const readNative =
    deps.readNativeClipboardImage
    ?? (async () => {
      const png = await readNativeClipboardPng();
      return fileFromPngBytes(png.bytes, png.fileName);
    });
  return withTimeout(
    readNative(),
    deps.nativeClipboardTimeoutMs ?? DEFAULT_NATIVE_CLIPBOARD_TIMEOUT_MS,
    "原生剪贴板读取",
  );
}

function clampPasteRange(
  view: EditorView,
  from: number,
  to: number,
): { from: number; to: number } {
  const max = view.state.doc.length;
  let mappedFrom = Math.max(0, Math.min(from, max));
  let mappedTo = Math.max(0, Math.min(to, max));
  if (mappedFrom > mappedTo) {
    const swap = mappedFrom;
    mappedFrom = mappedTo;
    mappedTo = swap;
  }
  return { from: mappedFrom, to: mappedTo };
}

export function createEditorPasteImageHandler(deps: EditorPasteImageDeps) {
  let inFlight = false;

  return async function onPasteImage(
    clipboardData: DataTransfer | null | undefined,
    view: EditorView,
  ): Promise<boolean> {
    if (inFlight) {
      return true;
    }
    inFlight = true;
    const selectionAtPaste = {
      from: view.state.selection.main.from,
      to: view.state.selection.main.to,
    };
    try {
      let file: File | null;
      try {
        file = await resolvePasteImageFile(clipboardData, deps);
      } catch (error) {
        await deps.showError("粘贴图片失败", error);
        return true;
      }
      if (!file) {
        if (shouldAttemptImagePasteFallbacks(clipboardData)) {
          await deps.showError("粘贴图片失败", new Error("剪贴板中没有可用图片"));
          return true;
        }
        return false;
      }

      let documentPath = deps.getDocumentPath();
      if (!documentPath) {
        const saved = await deps.ensureDocumentSaved();
        if (!saved) {
          await deps.showError(
            "粘贴图片失败",
            new Error("请先另存为文档后再粘贴图片"),
          );
          return true;
        }
        documentPath = deps.getDocumentPath();
        if (!documentPath) {
          await deps.showError(
            "粘贴图片失败",
            new Error("请先另存为文档后再粘贴图片"),
          );
          return true;
        }
      }

      const bytes = await readFileBytesLimited(file);
      const relativePath = buildPastedImageRelativePath(file.type || "image/png");
      const writtenPath = await writeRelativeImage(documentPath, relativePath, bytes);
      const markdown = buildMarkdownImageSyntax(writtenPath);
      const mapped = clampPasteRange(
        view,
        selectionAtPaste.from,
        selectionAtPaste.to,
      );
      view.dispatch({
        changes: { from: mapped.from, to: mapped.to, insert: markdown },
        selection: { anchor: mapped.from + markdown.length },
        userEvent: "input.paste",
      });
      view.focus();
      return true;
    } catch (error) {
      await deps.showError("粘贴图片失败", error);
      return true;
    } finally {
      inFlight = false;
    }
  };
}
