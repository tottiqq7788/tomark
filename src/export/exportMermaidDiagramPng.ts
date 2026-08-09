import { defaultExportBaseName } from "@/export/buildExportHtml";
import {
  ExportCancelledError,
  ExportFailedError,
} from "@/export/types";
import { saveBytesWithDialog, writeExportBytes } from "@/native/exportFileService";
import { renderMermaidSvg } from "@/preview/renderMermaid";
import { parseSvgNaturalSize } from "@/preview/useMermaidViewport";

const PNG_SCALE = 2;
const MAX_DIMENSION = 8192;
const MAX_AREA = 16_777_216;

export interface ExportMermaidDiagramPngOptions {
  source: string;
  fileName: string;
  diagramIndex?: number;
  /** Skip save dialog (tests / force path). */
  targetPath?: string;
  onProgress?: (message: string) => void;
}

export interface ExportMermaidDiagramPngResult {
  path: string;
  fileName: string;
  width: number;
  height: number;
}

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function suggestMermaidPngName(
  fileName: string,
  diagramIndex = 1,
): string {
  const base = defaultExportBaseName(fileName);
  const index = Number.isFinite(diagramIndex) && diagramIndex > 0
    ? Math.floor(diagramIndex)
    : 1;
  return `${base}-mermaid-${index}.png`;
}

const CONTENT_PAD_CSS = 8;
const CROP_PAD_PX = 8;
const NEAR_WHITE = 250;

function assertWithinCanvasLimits(width: number, height: number): void {
  if (
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_AREA
  ) {
    throw new ExportFailedError(
      "Mermaid 图表过大，无法在画布限制内以 2× 导出 PNG。",
    );
  }
}

/**
 * Mermaid often emits an oversized viewBox; tighten to the painted content box
 * (plus a small pad) so PNG / clipboard copies do not keep empty margins.
 */
export function tightenMermaidSvgToContent(
  svg: SVGSVGElement,
  pad = CONTENT_PAD_CSS,
): { width: number; height: number } {
  try {
    const box = svg.getBBox();
    if (box.width > 0 && box.height > 0) {
      const x = box.x - pad;
      const y = box.y - pad;
      const width = box.width + pad * 2;
      const height = box.height + pad * 2;
      svg.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.removeAttribute("style");
      return { width, height };
    }
  } catch {
    // getBBox can throw when the SVG is not measurable.
  }
  return parseSvgNaturalSize(svg);
}

/**
 * Trim near-white margins left by Mermaid's canvas or html2canvas measurement.
 * No-ops when the canvas API is unavailable (unit mocks) or content fills the frame.
 */
export function cropCanvasWhiteMargins(
  canvas: HTMLCanvasElement,
  pad = CROP_PAD_PX,
): HTMLCanvasElement {
  const ctx = canvas.getContext?.("2d");
  if (!ctx || typeof ctx.getImageData !== "function") {
    return canvas;
  }
  const { width, height } = canvas;
  if (width <= 0 || height <= 0) {
    return canvas;
  }
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, width, height);
  } catch {
    return canvas;
  }
  const data = image.data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha < 8) {
        continue;
      }
      if (
        data[i] >= NEAR_WHITE &&
        data[i + 1] >= NEAR_WHITE &&
        data[i + 2] >= NEAR_WHITE
      ) {
        continue;
      }
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) {
    return canvas;
  }
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);
  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  if (cropW >= width && cropH >= height) {
    return canvas;
  }
  const out = window.document.createElement("canvas");
  out.width = cropW;
  out.height = cropH;
  const outCtx = out.getContext("2d");
  if (!outCtx) {
    return canvas;
  }
  outCtx.fillStyle = "#ffffff";
  outCtx.fillRect(0, 0, cropW, cropH);
  outCtx.drawImage(canvas, left, top, cropW, cropH, 0, 0, cropW, cropH);
  return out;
}

/**
 * Rasterize a Mermaid diagram to PNG bytes (white background, fixed 2×).
 * Re-renders from authoritative source so preview DOM is not the export authority.
 */
export async function rasterizeMermaidDiagramPng(
  source: string,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const svg = await renderMermaidSvg(source);

  const host = window.document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;background:#ffffff;pointer-events:none;";
  host.innerHTML = `<div class="mermaid-diagram" data-mermaid="1" style="display:inline-block;background:#ffffff;padding:0;margin:0;border:none;line-height:0;">${svg}</div>`;
  window.document.body.appendChild(host);

  try {
    const target =
      (host.querySelector(".mermaid-diagram") as HTMLElement | null) ?? host;
    const svgEl = target.querySelector("svg");
    const natural =
      svgEl instanceof SVGSVGElement
        ? tightenMermaidSvgToContent(svgEl)
        : parseSvgNaturalSize(svg);
    const width = Math.max(1, Math.round(natural.width * PNG_SCALE));
    const height = Math.max(1, Math.round(natural.height * PNG_SCALE));
    assertWithinCanvasLimits(width, height);

    const html2canvas = (await import("html2canvas")).default;
    const rawCanvas = await html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: PNG_SCALE,
      useCORS: true,
      logging: false,
      width: natural.width,
      height: natural.height,
      windowWidth: natural.width,
      windowHeight: natural.height,
    });

    if (rawCanvas.width <= 0 || rawCanvas.height <= 0) {
      throw new ExportFailedError("PNG 画布尺寸无效");
    }

    const canvas = cropCanvasWhiteMargins(rawCanvas);
    assertWithinCanvasLimits(canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/png");
    });
    if (!blob) {
      throw new ExportFailedError("PNG 编码失败");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { bytes, width: canvas.width, height: canvas.height };
  } finally {
    host.remove();
  }
}

/**
 * Rasterize Mermaid to PNG (same semantics as file export) and write to clipboard.
 * Uses Web Clipboard ClipboardItem; does not require Tauri clipboard capability.
 */
export async function copyMermaidDiagramPngToClipboard(
  source: string,
): Promise<{ width: number; height: number }> {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new ExportFailedError("Mermaid 源码为空");
  }
  const { bytes, width, height } = await rasterizeMermaidDiagramPng(trimmed);
  const blob = new Blob([bytes], { type: "image/png" });
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

export async function exportMermaidDiagramPng(
  options: ExportMermaidDiagramPngOptions,
): Promise<ExportMermaidDiagramPngResult> {
  const source = options.source.trim();
  if (!source) {
    throw new ExportFailedError("Mermaid 源码为空");
  }

  options.onProgress?.("正在渲染 Mermaid…");
  const { bytes, width, height } = await rasterizeMermaidDiagramPng(source);

  const defaultPath = suggestMermaidPngName(
    options.fileName,
    options.diagramIndex ?? 1,
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

export { PNG_SCALE };
