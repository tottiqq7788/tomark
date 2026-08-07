import type {
  ImageResolutionResult,
  ImageWarning,
  ResolvedImage,
} from "./types";
import { invokeTauri } from "@/native/tauriRuntime";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const REMOTE_IMAGE_TIMEOUT_MS = 20_000;
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
  contentsBase64: string;
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
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push({
        src,
        reason,
      });
      nextHtml = replaceFailedImage(nextHtml, src, reason);
    }
  }

  return { html: nextHtml, images, warnings };
}

function collectImageSources(html: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  if (typeof document !== "undefined") {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const image of template.content.querySelectorAll("img[src]")) {
      const src = image.getAttribute("src")?.trim();
      if (!src || seen.has(src)) {
        continue;
      }
      seen.add(src);
      found.push(src);
    }
    return found;
  }

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
  const controller = new AbortController();
  const timer = globalThis.setTimeout(
    () => controller.abort(),
    REMOTE_IMAGE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(src, { signal: controller.signal });
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
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("网络图片下载超时（20 秒）");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function readLocalImage(
  documentPath: string,
  relativeSrc: string,
): Promise<Omit<ResolvedImage, "assetName">> {
  const decodedSrc = decodeLocalImageReference(relativeSrc);
  const extension = extensionFromPath(decodedSrc);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`不支持的图片类型：.${extension || "?"}`);
  }

  try {
    const payload = await invokeTauri<NativeImagePayload>("read_export_image", {
      documentPath,
      relativePath: decodedSrc,
      maxBytes: MAX_IMAGE_BYTES,
    });
    const bytes = base64ToBytes(payload.contentsBase64);
    const mimeType = normalizeMime(payload.mimeType);
    return {
      originalSrc: relativeSrc,
      dataUrl: `data:${mimeType};base64,${payload.contentsBase64}`,
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
  if (src.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024) {
    throw new Error("图片超过 8MB 限制");
  }
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(src);
  if (!match) {
    throw new Error("图片 data URL 无效");
  }
  const mime = normalizeMime(match[1] || "image/png");
  const extension = extensionFromMime(mime, "image.png");
  if (match[2] && match[3]) {
    let binary: string;
    try {
      binary = atob(match[3]);
    } catch {
      throw new Error("图片 data URL Base64 无效");
    }
    if (binary.length > MAX_IMAGE_BYTES) {
      throw new Error("图片超过 8MB 限制");
    }
    if (binary.length === 0) {
      throw new Error("图片为空");
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { bytes, extension };
  }
  try {
    const bytes = new TextEncoder().encode(
      decodeURIComponent(match[3] ?? ""),
    );
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("图片超过 8MB 限制");
    }
    if (bytes.byteLength === 0) {
      throw new Error("图片为空");
    }
    return { bytes, extension };
  } catch (error) {
    if (error instanceof Error && error.message.includes("8MB")) {
      throw error;
    }
    throw new Error("图片 data URL 编码无效");
  }
}

function replaceImgSrc(html: string, from: string, to: string): string {
  if (typeof document !== "undefined") {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const image of template.content.querySelectorAll("img[src]")) {
      if (image.getAttribute("src")?.trim() === from) {
        image.setAttribute("src", to);
      }
    }
    return template.innerHTML;
  }

  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(
    new RegExp(`(<img\\b[^>]*\\bsrc=["'])${escaped}(["'])`, "gi"),
    (_match, prefix: string, suffix: string) => `${prefix}${to}${suffix}`,
  );
}

function replaceFailedImage(
  html: string,
  src: string,
  reason: string,
): string {
  if (typeof document === "undefined") {
    return html;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll("img[src]")) {
    if (image.getAttribute("src")?.trim() !== src) {
      continue;
    }
    const fallback = document.createElement("span");
    fallback.className = "export-image-warning";
    fallback.title = reason;
    const alt = image.getAttribute("alt")?.trim();
    fallback.textContent = alt ? `图片未嵌入：${alt}` : "图片未能嵌入";
    image.replaceWith(fallback);
  }
  return template.innerHTML;
}

function decodeLocalImageReference(src: string): string {
  const pathOnly = src.split(/[?#]/, 1)[0] ?? "";
  try {
    return decodeURIComponent(pathOnly);
  } catch {
    throw new Error("本地图片路径包含无效的 URL 编码");
  }
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

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
