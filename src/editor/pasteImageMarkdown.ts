export const PASTE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function normalizeImageMime(mime: string | undefined | null): string | null {
  if (!mime) {
    return null;
  }
  const normalized = mime.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  return MIME_TO_EXT[normalized] ? normalized : null;
}

export function extensionForImageMime(mime: string | undefined | null): string | null {
  const normalized = normalizeImageMime(mime);
  return normalized ? MIME_TO_EXT[normalized] : null;
}

export function isSupportedPasteImageMime(mime: string | undefined | null): boolean {
  return extensionForImageMime(mime) != null;
}

export function sniffImageMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6
    && bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39)
    && bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function clipboardTypes(clipboardData: DataTransfer): string[] {
  try {
    return Array.from(clipboardData.types ?? []);
  } catch {
    return [];
  }
}

function hasPlainTextSignal(clipboardData: DataTransfer, types: string[]): boolean {
  if (types.some((type) => type === "text/plain" || type === "text/html")) {
    try {
      const text = clipboardData.getData("text/plain");
      if (typeof text === "string" && text.trim() !== "") {
        return true;
      }
    } catch {
      // Some WebViews throw when reading text while files are present.
    }
    return types.includes("text/plain") || types.includes("text/html");
  }
  return false;
}

function hasImageTypeSignal(types: string[]): boolean {
  return types.some((type) => {
    const lower = type.toLowerCase();
    return (
      lower.startsWith("image/")
      || lower === "files"
      || lower.includes("png")
      || lower.includes("tiff")
      || lower.includes("jpeg")
      || lower.includes("jpg")
      || lower.includes("gif")
      || lower.includes("webp")
      || lower.includes("public.png")
      || lower.includes("public.tiff")
    );
  });
}

async function fileWithResolvedMime(
  file: File,
  preferredMime: string | null,
): Promise<File | null> {
  const direct = normalizeImageMime(file.type) ?? normalizeImageMime(preferredMime);
  if (direct) {
    if (normalizeImageMime(file.type) === direct) {
      return file;
    }
    return new File([file], file.name || `pasted.${extensionForImageMime(direct)}`, {
      type: direct,
      lastModified: file.lastModified,
    });
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageMimeFromBytes(head);
  if (!sniffed) {
    return null;
  }
  return new File([file], file.name || `pasted.${extensionForImageMime(sniffed)}`, {
    type: sniffed,
    lastModified: file.lastModified,
  });
}

/** First supported image from a paste clipboard, if any. */
export async function extractClipboardImageFile(
  clipboardData: DataTransfer | null | undefined,
): Promise<File | null> {
  if (!clipboardData) {
    return null;
  }

  const items = clipboardData.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind !== "file") {
        continue;
      }
      const itemMime = normalizeImageMime(item.type);
      const typeHint = (item.type || "").toLowerCase();
      const looksLikeImageItem =
        !typeHint
        || typeHint.startsWith("image/")
        || itemMime != null
        || /png|jpe?g|gif|webp|tiff/.test(typeHint);
      if (typeHint && !looksLikeImageItem) {
        continue;
      }
      const raw = item.getAsFile();
      if (!raw) {
        continue;
      }
      const file = await fileWithResolvedMime(raw, itemMime);
      if (file) {
        return file;
      }
    }
  }

  const files = clipboardData.files;
  if (files) {
    for (let i = 0; i < files.length; i += 1) {
      const raw = files[i];
      if (!raw) {
        continue;
      }
      const file = await fileWithResolvedMime(raw, null);
      if (file) {
        return file;
      }
    }
  }
  return null;
}

export async function extractAsyncClipboardImageFile(
  clipboard: Clipboard | null | undefined = navigator.clipboard,
): Promise<File | null> {
  if (!clipboard || typeof clipboard.read !== "function") {
    return null;
  }
  const items = await clipboard.read();
  for (const item of items) {
    const types = item.types ?? [];
    const pngType = types.find((type) => normalizeImageMime(type) === "image/png");
    const supportedType =
      pngType
      ?? types.find((type) => isSupportedPasteImageMime(type));
    if (!supportedType) {
      continue;
    }
    const blob = await item.getType(supportedType);
    const mime = normalizeImageMime(supportedType) ?? normalizeImageMime(blob.type);
    if (!mime) {
      continue;
    }
    return new File([blob], `clipboard.${extensionForImageMime(mime)}`, {
      type: mime,
    });
  }
  return null;
}

export function shouldAttemptImagePasteFallbacks(
  clipboardData: DataTransfer | null | undefined,
): boolean {
  if (!clipboardData) {
    return true;
  }
  const types = clipboardTypes(clipboardData);
  const imageSignal = hasImageTypeSignal(types);
  const textSignal = hasPlainTextSignal(clipboardData, types);
  if (textSignal && !imageSignal) {
    return false;
  }
  return imageSignal || !textSignal;
}

function hasClipboardFileItems(clipboardData: DataTransfer): boolean {
  try {
    const items = clipboardData.items;
    if (items) {
      for (let i = 0; i < items.length; i += 1) {
        if (items[i]?.kind === "file") {
          return true;
        }
      }
    }
  } catch {
    // ignore
  }
  try {
    return Boolean(clipboardData.files && clipboardData.files.length > 0);
  } catch {
    return false;
  }
}

/**
 * WKWebView screenshot pasteboards expose image UTIs without File items.
 * Async Clipboard often hangs on permission there — prefer native read-image.
 */
export function shouldSkipAsyncClipboardFallback(
  clipboardData: DataTransfer | null | undefined,
): boolean {
  if (!clipboardData) {
    return false;
  }
  const types = clipboardTypes(clipboardData);
  return hasImageTypeSignal(types) && !hasClipboardFileItems(clipboardData);
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

export function fileFromPngBytes(bytes: Uint8Array, fileName = "clipboard.png"): File {
  const copy = Uint8Array.from(bytes);
  return new File([copy], fileName, { type: "image/png" });
}
