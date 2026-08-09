import { defaultExportBaseName } from "@/export/buildExportHtml";
import {
  ExportCancelledError,
  ExportFailedError,
} from "@/export/types";
import { saveTextWithDialog, writeExportText } from "@/native/exportFileService";
import { renderMermaidSvg } from "@/preview/renderMermaid";

export interface ExportMermaidDiagramSvgOptions {
  source: string;
  fileName: string;
  diagramIndex?: number;
  /** Skip save dialog (tests / force path). */
  targetPath?: string;
  onProgress?: (message: string) => void;
}

export interface ExportMermaidDiagramSvgResult {
  path: string;
  fileName: string;
}

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function suggestMermaidSvgName(
  fileName: string,
  diagramIndex = 1,
): string {
  const base = defaultExportBaseName(fileName);
  const index =
    Number.isFinite(diagramIndex) && diagramIndex > 0
      ? Math.floor(diagramIndex)
      : 1;
  return `${base}-mermaid-${index}.svg`;
}

/**
 * Export a Mermaid diagram as SVG text, re-rendered from the authoritative
 * fence-body snapshot (preview DOM is not the authority).
 */
export async function exportMermaidDiagramSvg(
  options: ExportMermaidDiagramSvgOptions,
): Promise<ExportMermaidDiagramSvgResult> {
  const source = options.source.trim();
  if (!source) {
    throw new ExportFailedError("Mermaid 源码为空");
  }

  options.onProgress?.("正在渲染 Mermaid…");
  const svg = await renderMermaidSvg(source);
  if (!svg.includes("<svg")) {
    throw new ExportFailedError("Mermaid 未返回有效 SVG");
  }

  const defaultPath = suggestMermaidSvgName(
    options.fileName,
    options.diagramIndex ?? 1,
  );

  if (options.targetPath && options.targetPath.trim() !== "") {
    options.onProgress?.("正在写入文件…");
    await writeExportText(options.targetPath, svg);
    return {
      path: options.targetPath,
      fileName: fileNameFromPath(options.targetPath),
    };
  }

  options.onProgress?.("请选择保存位置…");
  try {
    return await saveTextWithDialog({
      defaultPath,
      filters: [{ name: "SVG", extensions: ["svg"] }],
      contents: svg,
    });
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
