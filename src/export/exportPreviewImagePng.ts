import { defaultExportBaseName } from "@/export/buildExportHtml";
import {
  ExportCancelledError,
  ExportFailedError,
} from "@/export/types";
import { saveBytesWithDialog, writeExportBytes } from "@/native/exportFileService";

const MAX_DIMENSION = 8192;
const MAX_AREA = 16_777_216;

export interface ExportPreviewImagePngOptions {
  dataUrl: string;
  bytes?: Uint8Array;
  mimeType?: string;
  fileName: string;
  imageIndex?: number;
  targetPath?: string;
  onProgress?: (message: string) => void;
}

export interface ExportPreviewImagePngResult {
  path: string;
  fileName: string;
  width: number;
  height: number;
}

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function suggestPreviewImagePngName(
  fileName: string,
  imageIndex = 1,
): string {
  const base = defaultExportBaseName(fileName);
  const index =
    Number.isFinite(imageIndex) && imageIndex > 0 ? Math.floor(imageIndex) : 1;
  return `${base}-image-${index}.png`;
}

function assertWithinCanvasLimits(width: number, height: number): void {
  if (
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_AREA
  ) {
    throw new ExportFailedError(
      "图片过大，无法在画布限制内导出 PNG。",
    );
  }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ExportFailedError("图片解码失败"));
    img.src = dataUrl;
  });
}

/**
 * Encode a resolved preview image as PNG bytes at natural size.
 * Transparent pixels are flattened onto white. Existing PNG bytes may be reused.
 */
export async function encodePreviewImagePng(options: {
  dataUrl: string;
  bytes?: Uint8Array;
  mimeType?: string;
}): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const mime = (options.mimeType || "").toLowerCase();
  if (mime === "image/png" && options.bytes && options.bytes.byteLength > 0) {
    const img = await loadImage(options.dataUrl);
    const width = Math.max(1, img.naturalWidth || img.width);
    const height = Math.max(1, img.naturalHeight || img.height);
    assertWithinCanvasLimits(width, height);
    return { bytes: options.bytes, width, height };
  }

  const img = await loadImage(options.dataUrl);
  const width = Math.max(1, Math.round(img.naturalWidth || img.width));
  const height = Math.max(1, Math.round(img.naturalHeight || img.height));
  assertWithinCanvasLimits(width, height);

  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ExportFailedError("无法创建 PNG 画布");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/png");
  });
  if (!blob) {
    throw new ExportFailedError("PNG 编码失败");
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, width, height };
}

export async function copyPreviewImagePngToClipboard(options: {
  dataUrl: string;
  bytes?: Uint8Array;
  mimeType?: string;
}): Promise<{ width: number; height: number }> {
  const { bytes, width, height } = await encodePreviewImagePng(options);
  const blob = new Blob([Uint8Array.from(bytes)], { type: "image/png" });
  const clipboard = navigator.clipboard;
  if (!clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new ExportFailedError("当前环境不支持复制图片到剪贴板");
  }
  await clipboard.write([
    new ClipboardItem({
      "image/png": Promise.resolve(blob),
    }),
  ]);
  return { width, height };
}

export async function exportPreviewImagePng(
  options: ExportPreviewImagePngOptions,
): Promise<ExportPreviewImagePngResult> {
  if (!options.dataUrl.trim()) {
    throw new ExportFailedError("图片数据为空");
  }
  options.onProgress?.("正在编码 PNG…");
  const { bytes, width, height } = await encodePreviewImagePng({
    dataUrl: options.dataUrl,
    bytes: options.bytes,
    mimeType: options.mimeType,
  });

  const defaultPath = suggestPreviewImagePngName(
    options.fileName,
    options.imageIndex ?? 1,
  );

  if (options.targetPath && options.targetPath.trim() !== "") {
    options.onProgress?.("正在写入文件…");
    await writeExportBytes(options.targetPath, bytes);
    return {
      path: options.targetPath,
      fileName: fileNameFromPath(options.targetPath),
      width,
      height,
    };
  }

  options.onProgress?.("请选择保存位置…");
  try {
    const saved = await saveBytesWithDialog({
      defaultPath,
      filters: [{ name: "PNG", extensions: ["png"] }],
      bytes,
    });
    return { ...saved, width, height };
  } catch (error) {
    if (
      error instanceof ExportCancelledError ||
      (error instanceof Error && error.name === "ExportCancelledError")
    ) {
      throw error;
    }
    throw error instanceof Error
      ? error
      : new ExportFailedError(String(error));
  }
}
