import {
  buildExportDocument,
  buildHtmlAssetsBundle,
  defaultExportBaseName,
} from "./buildExportHtml";
import { buildLongImagePdfFromPng } from "./buildLongImagePdfFromPng";
import {
  EXPORT_CONTENT_WIDTH_PX,
  ExportCancelledError,
  ExportFailedError,
  type ExportFormatId,
  type ExportProgressHandler,
  type ImageWarning,
} from "./types";
import {
  writeHtmlAssetBundle,
  pickExportPath,
  writeExportBytes,
} from "@/native/exportFileService";
import { renderMermaidForExport } from "@/preview/renderMermaid";

export interface RunExportOptions {
  format: ExportFormatId;
  markdownSource: string;
  documentPath: string | null;
  fileName: string;
  onProgress?: ExportProgressHandler;
  /** Skip the save dialog (dev / force-export). */
  targetPath?: string;
}

export interface RunExportResult {
  path: string;
  fileName: string;
  warnings: ImageWarning[];
  note?: string;
}

export type ExportRendererId = "png" | "pdf";

function suggestName(fileName: string, extension: string): string {
  return `${defaultExportBaseName(fileName)}.${extension}`;
}

export function exportTargetDialogOptions(
  format: ExportFormatId,
  fileName: string,
): {
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
} {
  switch (format) {
    case "html-embedded":
    case "html-assets":
      return {
        defaultPath: suggestName(fileName, "html"),
        filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      };
    case "png":
      return {
        defaultPath: suggestName(fileName, "png"),
        filters: [{ name: "PNG", extensions: ["png"] }],
      };
    case "pdf":
      return {
        defaultPath: suggestName(fileName, "pdf"),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      };
    default: {
      const exhaustive: never = format;
      throw new ExportFailedError(`未知导出格式：${String(exhaustive)}`);
    }
  }
}

/** Ask for a save path without building the export document. Returns null if cancelled. */
export async function selectExportTargetPath(
  format: ExportFormatId,
  fileName: string,
): Promise<string | null> {
  return pickExportPath(exportTargetDialogOptions(format, fileName));
}

function loadPngRenderer() {
  return import("html2canvas");
}

function loadPdfEncoder() {
  return import("./buildLongImagePdfFromPng");
}

/** Load lazy export engines without rendering; used by the browser smoke test. */
export async function preloadExportRenderer(
  renderer: ExportRendererId,
): Promise<void> {
  switch (renderer) {
    case "png":
      await loadPngRenderer();
      return;
    case "pdf":
      await Promise.all([loadPngRenderer(), loadPdfEncoder()]);
      return;
    default: {
      const exhaustive: never = renderer;
      throw new ExportFailedError(`未知导出渲染器：${String(exhaustive)}`);
    }
  }
}

export async function runExport(
  options: RunExportOptions,
): Promise<RunExportResult> {
  const baseName = defaultExportBaseName(options.fileName);
  const title = baseName;

  switch (options.format) {
    case "html-embedded":
      return exportEmbeddedHtml(options, title);
    case "html-assets":
      return exportAssetsHtml(options, title, baseName);
    case "png":
      return exportPng(options, title);
    case "pdf":
      return exportPdf(options, title);
    default: {
      const exhaustive: never = options.format;
      throw new ExportFailedError(`未知导出格式：${String(exhaustive)}`);
    }
  }
}

async function exportEmbeddedHtml(
  options: RunExportOptions,
  title: string,
): Promise<RunExportResult> {
  const document = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: true,
  });
  const targetPath = await resolveExportTargetPathForFormat(options);
  await writeExportBytes(
    targetPath,
    new TextEncoder().encode(document.fullHtml),
  );
  return {
    path: targetPath,
    fileName: fileNameFromPath(targetPath),
    warnings: document.warnings,
  };
}

async function exportAssetsHtml(
  options: RunExportOptions,
  title: string,
  baseName: string,
): Promise<RunExportResult> {
  const document = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: false,
  });
  const htmlPath = await resolveExportTargetPathForFormat(options);
  const outputFileName = fileNameFromPath(htmlPath);
  const extensionIndex = outputFileName.lastIndexOf(".");
  const outputBaseName =
    extensionIndex > 0 &&
    /^html?$/i.test(outputFileName.slice(extensionIndex + 1))
      ? outputFileName.slice(0, extensionIndex)
      : outputFileName || baseName;
  const bundle = buildHtmlAssetsBundle(document, outputBaseName);
  await writeHtmlAssetBundle({
    htmlPath,
    htmlContent: bundle.htmlContent,
    assetsDirName: bundle.assetsDirName,
    assets: bundle.assets.map((asset) => ({
      relativePath: asset.relativePath,
      bytes: asset.bytes,
    })),
  });
  return {
    path: htmlPath,
    fileName: htmlPath.replace(/\\/g, "/").split("/").pop() || `${baseName}.html`,
    warnings: bundle.warnings,
  };
}

function fileNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function reportProgress(
  options: RunExportOptions,
  message: string,
): void {
  options.onProgress?.(message);
}

async function resolveExportTargetPath(
  options: RunExportOptions,
  pick: {
    defaultPath: string;
    filters: { name: string; extensions: string[] }[];
  },
): Promise<string> {
  if (options.targetPath && options.targetPath.trim() !== "") {
    return options.targetPath;
  }
  reportProgress(options, "请选择保存位置…");
  const targetPath = await pickExportPath(pick);
  if (!targetPath) {
    throw new ExportCancelledError();
  }
  return targetPath;
}

async function resolveExportTargetPathForFormat(
  options: RunExportOptions,
): Promise<string> {
  return resolveExportTargetPath(
    options,
    exportTargetDialogOptions(options.format, options.fileName),
  );
}

interface LongImageRaster {
  bytes: Uint8Array;
  warnings: ImageWarning[];
  note?: string;
}

async function renderLongImagePng(
  options: RunExportOptions,
  title: string,
  progressLabel: string,
): Promise<LongImageRaster> {
  reportProgress(options, progressLabel);
  const exportDoc = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: true,
  });

  const host = window.document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;width:920px;background:#fff;pointer-events:none;";
  host.innerHTML = `<style>${exportDoc.css}</style><article class="markdown-body export-root">${exportDoc.bodyHtml}</article>`;
  window.document.body.appendChild(host);

  try {
    await renderMermaidForExport(host);
    await waitForExportImages(host);
    const article = host.querySelector(".export-root") as HTMLElement | null;
    if (!article) {
      throw new ExportFailedError("无法构建长图导出节点");
    }

    const width = Math.max(article.scrollWidth, EXPORT_CONTENT_WIDTH_PX);
    const height = Math.max(article.scrollHeight, 1);
    const scale = computeExportPngScale(width, height);
    const note =
      scale < 2
        ? `长图已按 ${scale.toFixed(2)}x 降采样，以避免超出画布上限。`
        : undefined;

    const html2canvas = (await loadPngRenderer()).default;
    const canvas = await html2canvas(article, {
      backgroundColor: "#ffffff",
      scale,
      useCORS: true,
      logging: false,
      width,
      windowWidth: width,
    });

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((value) => resolve(value), "image/png");
    });
    if (!blob) {
      throw new ExportFailedError("长图编码失败");
    }
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      warnings: exportDoc.warnings,
      note,
    };
  } finally {
    host.remove();
  }
}

async function exportPng(
  options: RunExportOptions,
  title: string,
): Promise<RunExportResult> {
  const targetPath = await resolveExportTargetPathForFormat(options);
  const raster = await renderLongImagePng(options, title, "正在生成长图…");
  reportProgress(options, "正在写入文件…");
  await writeExportBytes(targetPath, raster.bytes);
  return {
    path: targetPath,
    fileName: fileNameFromPath(targetPath),
    warnings: raster.warnings,
    note: raster.note,
  };
}

async function exportPdf(
  options: RunExportOptions,
  title: string,
): Promise<RunExportResult> {
  const targetPath = await resolveExportTargetPathForFormat(options);
  const raster = await renderLongImagePng(options, title, "正在生成长图…");
  reportProgress(options, "正在封装 PDF…");
  const pdfBytes = await buildLongImagePdfFromPng(raster.bytes);
  reportProgress(options, "正在写入文件…");
  await writeExportBytes(targetPath, pdfBytes);
  const pdfNote =
    "长图单页 PDF（位图，不可检索文字；超高单页在部分阅读器体验较差）。";
  return {
    path: targetPath,
    fileName: fileNameFromPath(targetPath),
    warnings: raster.warnings,
    note: raster.note ? `${raster.note} ${pdfNote}` : pdfNote,
  };
}

/** Exported for unit tests; keeps PNG within WebKit canvas limits. */
export function computeExportPngScale(width: number, height: number): number {
  const maxDimension = 8192;
  const maxArea = 16_777_216;
  const minScale = 0.125;
  let scale = 2;
  while (
    scale > minScale &&
    (width * scale > maxDimension ||
      height * scale > maxDimension ||
      width * height * scale * scale > maxArea)
  ) {
    scale = Math.max(minScale, Number((scale - 0.125).toFixed(3)));
  }
  if (
    width * scale > maxDimension ||
    height * scale > maxDimension ||
    width * height * scale * scale > maxArea
  ) {
    throw new ExportFailedError(
      "文档过长，无法在画布限制内导出长图。请改用 HTML。",
    );
  }
  return scale;
}

export function waitForExportImages(
  root: HTMLElement,
  timeoutMs = 10_000,
): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          let settled = false;
          let timer = 0;
          const done = () => {
            if (settled) {
              return;
            }
            settled = true;
            window.clearTimeout(timer);
            img.removeEventListener("load", done);
            img.removeEventListener("error", done);
            resolve();
          };
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          if (typeof img.decode === "function") {
            void img.decode().then(done, done);
          }
          // Some WebViews never settle malformed data URLs. Keep export bounded,
          // but do not race valid multi-megabyte image decoding after 50 ms.
          timer = window.setTimeout(done, timeoutMs);
        }),
    ),
  ).then(() => undefined);
}
