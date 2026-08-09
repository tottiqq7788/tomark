import { resolveOneImage } from "@/export/resolveImages";

export interface PreviewResolvedImage {
  originalSrc: string;
  dataUrl: string;
  bytes?: Uint8Array;
  mimeType: string;
  extension: string;
}

const cache = new Map<string, Promise<PreviewResolvedImage>>();

function cacheKey(documentPath: string | null, src: string): string {
  return `${documentPath ?? ""}::${src}`;
}

function mimeFromExtension(extension: string): string {
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "png":
    default:
      return "image/png";
  }
}

function mimeFromDataUrl(dataUrl: string, extension: string): string {
  const match = /^data:([^;,]+)/i.exec(dataUrl);
  if (match?.[1]) {
    return match[1].trim().toLowerCase();
  }
  return mimeFromExtension(extension);
}

/** Clear cached preview image resolutions (document switch / tests). */
export function clearPreviewImageCache(): void {
  cache.clear();
}

/**
 * Resolve an image src for preview display/export.
 * Reuses export-side resolution (data / http(s) / local relative via read_export_image).
 */
export function resolvePreviewImage(
  src: string,
  documentPath: string | null,
): Promise<PreviewResolvedImage> {
  const trimmed = src.trim();
  const key = cacheKey(documentPath, trimmed);
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const pending = resolveOneImage(trimmed, documentPath)
    .then((resolved) => {
      const mimeType = mimeFromDataUrl(resolved.dataUrl, resolved.extension);
      return {
        originalSrc: resolved.originalSrc,
        dataUrl: resolved.dataUrl,
        bytes: resolved.bytes,
        mimeType,
        extension: resolved.extension,
      } satisfies PreviewResolvedImage;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, pending);
  return pending;
}
