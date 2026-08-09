import { PASTE_IMAGE_MAX_BYTES } from "@/editor/pasteImageMarkdown";
import { assertTauriIpcReady } from "@/native/tauriRuntime";

export type NativeClipboardPng = {
  bytes: Uint8Array;
  mime: "image/png";
  fileName: string;
};

function mapInvokeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error(String(error));
}

export async function encodeRgbaToPngBytes(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxBytes: number = PASTE_IMAGE_MAX_BYTES,
): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("剪贴板图片尺寸无效");
  }
  const expected = width * height * 4;
  if (rgba.byteLength < expected) {
    throw new Error("剪贴板图片数据不完整");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) {
    throw new Error("无法编码剪贴板图片");
  }
  const pixels = Uint8ClampedArray.from(rgba.subarray(0, expected));
  const imageData =
    typeof ImageData === "function"
      ? new ImageData(pixels, width, height)
      : ({
          data: pixels,
          width,
          height,
          colorSpace: "srgb",
        } as ImageData);
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => {
        if (!value) {
          reject(new Error("无法编码剪贴板图片为 PNG"));
          return;
        }
        resolve(value);
      },
      "image/png",
    );
  });
  if (blob.size > maxBytes) {
    throw new Error("图片超过大小限制");
  }
  const buffer = await blob.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error("图片内容为空");
  }
  if (buffer.byteLength > maxBytes) {
    throw new Error("图片超过大小限制");
  }
  return new Uint8Array(buffer);
}

/** Read system clipboard image via Tauri and normalize to PNG bytes. */
export async function readNativeClipboardPng(
  maxBytes: number = PASTE_IMAGE_MAX_BYTES,
): Promise<NativeClipboardPng> {
  assertTauriIpcReady("读取剪贴板图片");
  let image: {
    rgba: () => Promise<Uint8Array | number[]>;
    size: () => Promise<{ width: number; height: number }>;
    close: () => Promise<void>;
  } | null = null;
  try {
    const { readImage } = await import("@tauri-apps/plugin-clipboard-manager");
    image = await readImage();
    const size = await image.size();
    const rgbaRaw = await image.rgba();
    const rgba =
      rgbaRaw instanceof Uint8Array ? rgbaRaw : new Uint8Array(rgbaRaw);
    const bytes = await encodeRgbaToPngBytes(
      rgba,
      size.width,
      size.height,
      maxBytes,
    );
    return {
      bytes,
      mime: "image/png",
      fileName: "clipboard.png",
    };
  } catch (error) {
    throw mapInvokeError(error);
  } finally {
    if (image) {
      try {
        await image.close();
      } catch {
        // Resource cleanup must not mask the primary read/encode error.
      }
    }
  }
}
