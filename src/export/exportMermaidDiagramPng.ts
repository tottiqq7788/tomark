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
 * Rasterize a Mermaid diagram to PNG bytes (white background, fixed 2×).
 * Re-renders from authoritative source so preview DOM is not the export authority.
 */
export async function rasterizeMermaidDiagramPng(
  source: string,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const svg = await renderMermaidSvg(source);
  const natural = parseSvgNaturalSize(svg);
  const width = Math.max(1, Math.round(natural.width * PNG_SCALE));
  const height = Math.max(1, Math.round(natural.height * PNG_SCALE));
  assertWithinCanvasLimits(width, height);

  const host = window.document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;background:#ffffff;pointer-events:none;";
  host.innerHTML = `<div class="mermaid-diagram" data-mermaid="1" style="display:inline-block;background:#ffffff;padding:0;margin:0;border:none;">${svg}</div>`;
  window.document.body.appendChild(host);

  try {
    const target =
      (host.querySelector(".mermaid-diagram") as HTMLElement | null) ?? host;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: PNG_SCALE,
      useCORS: true,
      logging: false,
      width: natural.width,
      height: natural.height,
      windowWidth: natural.width,
      windowHeight: natural.height,
    });

    if (canvas.width <= 0 || canvas.height <= 0) {
      throw new ExportFailedError("PNG 画布尺寸无效");
    }

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
