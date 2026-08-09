export const PASTE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function extensionForImageMime(mime: string | undefined | null): string | null {
  if (!mime) {
    return null;
  }
  const normalized = mime.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  return MIME_TO_EXT[normalized] ?? null;
}

export function isSupportedPasteImageFile(file: File): boolean {
  return extensionForImageMime(file.type) != null;
}

/** First supported image from a paste clipboard, if any. */
export function extractClipboardImageFile(
  clipboardData: DataTransfer | null | undefined,
): File | null {
  if (!clipboardData) {
    return null;
  }
  const items = clipboardData.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind !== "file" || !item.type.startsWith("image/")) {
        continue;
      }
      const file = item.getAsFile();
      if (file && isSupportedPasteImageFile(file)) {
        return file;
      }
    }
  }
  const files = clipboardData.files;
  if (files) {
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      if (file && isSupportedPasteImageFile(file)) {
        return file;
      }
    }
  }
  return null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function buildPastedImageRelativePath(
  mime: string,
  now: Date = new Date(),
  randomSuffix: string = Math.random().toString(36).slice(2, 8),
): string {
  const ext = extensionForImageMime(mime);
  if (!ext) {
    throw new Error(`不支持的图片类型：${mime || "unknown"}`);
  }
  const stamp = [
    now.getFullYear(),
    pad2(now.getMonth() + 1),
    pad2(now.getDate()),
    "-",
    pad2(now.getHours()),
    pad2(now.getMinutes()),
    pad2(now.getSeconds()),
  ].join("");
  const safeSuffix = randomSuffix.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "img";
  return `assets/pasted-${stamp}-${safeSuffix}.${ext}`;
}

export function buildMarkdownImageSyntax(relativePath: string, alt = ""): string {
  const path = relativePath.replace(/\\/g, "/");
  return `![${alt}](${path})`;
}

export async function readFileBytesLimited(
  file: File,
  maxBytes: number = PASTE_IMAGE_MAX_BYTES,
): Promise<Uint8Array> {
  if (file.size > maxBytes) {
    throw new Error("图片超过大小限制");
  }
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error("图片超过大小限制");
  }
  if (buffer.byteLength === 0) {
    throw new Error("图片内容为空");
  }
  return new Uint8Array(buffer);
}
