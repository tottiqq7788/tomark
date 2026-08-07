import { invoke } from "@tauri-apps/api/core";
import type {
  ImageResolutionResult,
  ImageWarning,
  ResolvedImage,
} from "./types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
]);

type ResolveMode = "embed" | "assets";

interface ResolveImagesOptions {
  documentPath: string | null;
  mode: ResolveMode;
  baseName: string;
}

interface NativeImagePayload {
  bytes: number[];
  mimeType: string;
  extension: string;
}

export async function resolveImagesInHtml(
  html: string,
  options: ResolveImagesOptions,
): Promise<ImageResolutionResult> {
  const sources = collectImageSources(html);
  const images: ResolvedImage[] = [];
  const warnings: ImageWarning[] = [];
  let nextHtml = html;
  let assetIndex = 0;

  for (const src of sources) {
    try {
      const resolved = await resolveOneImage(src, options.documentPath);
      assetIndex += 1;
      const assetName = `${sanitizeAssetBase(options.baseName)}-${String(assetIndex).padStart(2, "0")}.${resolved.extension}`;
      const entry: ResolvedImage = {
        ...resolved,
        assetName,
      };
      images.push(entry);

      if (options.mode === "embed") {
        nextHtml = replaceImgSrc(nextHtml, src, entry.dataUrl);
      }
    } catch (error) {
      warnings.push({
        src,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { html: nextHtml, images, warnings };
}

function collectImageSources(html: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const src = match[1]?.trim();
    if (!src || seen.has(src)) {
      continue;
    }
    seen.add(src);
    found.push(src);
  }
  return found;
}

async function resolveOneImage(
  src: string,
  documentPath: string | null,
): Promise<Omit<ResolvedImage, "assetName">> {
  if (src.startsWith("data:")) {
    const parsed = parseDataUrl(src);
    return {
      originalSrc: src,
      dataUrl: src,
      extension: parsed.extension,
      bytes: parsed.bytes,
    };
  }

  if (/^https?:\/\//i.test(src)) {
    return fetchRemoteImage(src);
  }

  if (/^(file:|\/|[a-zA-Z]:[\\/]|\\\\)/.test(src)) {
    throw new Error("不支持绝对路径图片");
  }

  if (!documentPath) {
    throw new Error("文档尚未保存，无法读取相对路径本地图片");
  }

  return readLocalImage(documentPath, src);
}

async function fetchRemoteImage(
  src: string,
): Promise<Omit<ResolvedImage, "assetName">> {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`网络图片下载失败（HTTP ${response.status}）`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new Error("网络图片为空");
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("图片超过 8MB 限制");
  }
  const mimeType = normalizeMime(
    response.headers.get("content-type") ?? guessMimeFromPath(src),
  );
  const extension = extensionFromMime(mimeType, src);
  return {
    originalSrc: src,
    dataUrl: bytesToDataUrl(buffer, mimeType),
    extension,
    bytes: buffer,
  };
}

async function readLocalImage(
  documentPath: string,
  relativeSrc: string,
): Promise<Omit<ResolvedImage, "assetName">> {
  const extension = extensionFromPath(relativeSrc);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`不支持的图片类型：.${extension || "?"}`);
  }

  try {
    const payload = await invoke<NativeImagePayload>("read_export_image", {
      documentPath,
      relativePath: relativeSrc,
      maxBytes: MAX_IMAGE_BYTES,
    });
    const bytes = Uint8Array.from(payload.bytes);
    const mimeType = normalizeMime(payload.mimeType);
    return {
      originalSrc: relativeSrc,
      dataUrl: bytesToDataUrl(bytes, mimeType),
      extension: payload.extension || extension,
      bytes,
    };
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : `读取本地图片失败：${String(error)}`,
    );
  }
}

function parseDataUrl(src: string): { bytes?: Uint8Array; extension: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(src);
  if (!match) {
    return { extension: "png" };
  }
  const mime = normalizeMime(match[1] || "image/png");
  const extension = extensionFromMime(mime, "image.png");
  if (match[2] && match[3]) {
    try {
      const binary = atob(match[3]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { bytes, extension };
    } catch {
      return { extension };
    }
  }
  return { extension };
}

function replaceImgSrc(html: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(
    new RegExp(`(<img\\b[^>]*\\bsrc=["'])${escaped}(["'])`, "gi"),
    `$1${to}$2`,
  );
}

function sanitizeAssetBase(value: string): string {
  const cleaned = value
    .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned || "image";
}

function extensionFromPath(path: string): string {
  const clean = path.split("?")[0]?.split("#")[0] ?? "";
  const parts = clean.split(".");
  if (parts.length < 2) {
    return "";
  }
  return (parts[parts.length - 1] || "").toLowerCase();
}

function guessMimeFromPath(path: string): string {
  return mimeFromExtension(extensionFromPath(path));
}

function extensionFromMime(mime: string, fallbackPath: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/png":
      return "png";
    default:
      return extensionFromPath(fallbackPath) || "png";
  }
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

function normalizeMime(value: string): string {
  const mime = value.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
  if (mime.startsWith("image/")) {
    return mime;
  }
  return "image/png";
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
