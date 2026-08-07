import {
  buildExportDocument,
  buildHtmlAssetsBundle,
  defaultExportBaseName,
  exportShellCss,
  wrapExportHtml,
} from "./buildExportHtml";
import {
  EXPORT_CONTENT_WIDTH_PX,
  ExportCancelledError,
  ExportFailedError,
  type ExportFormatId,
  type ImageWarning,
} from "./types";
import {
  saveBytesWithDialog,
  writeHtmlAssetBundle,
  pickExportPath,
} from "@/native/exportFileService";

export interface RunExportOptions {
  format: ExportFormatId;
  markdownSource: string;
  documentPath: string | null;
  fileName: string;
}

export interface RunExportResult {
  path: string;
  fileName: string;
  warnings: ImageWarning[];
  note?: string;
}

function suggestName(fileName: string, extension: string): string {
  return `${defaultExportBaseName(fileName)}.${extension}`;
}

export async function runExport(
  options: RunExportOptions,
): Promise<RunExportResult> {
  const baseName = defaultExportBaseName(options.fileName);
  const title = baseName;

  switch (options.format) {
    case "html-embedded":
      return exportEmbeddedHtml(options, title, baseName);
    case "html-assets":
      return exportAssetsHtml(options, title, baseName);
    case "pdf":
      return exportPdf(options, title, baseName);
    case "docx":
      return exportDocx(options, title, baseName);
    case "png":
      return exportPng(options, title, baseName);
    default:
      throw new ExportFailedError(`未知导出格式：${String(options.format)}`);
  }
}

async function exportEmbeddedHtml(
  options: RunExportOptions,
  title: string,
  _baseName: string,
): Promise<RunExportResult> {
  const document = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: true,
  });
  const saved = await saveBytesWithDialog({
    defaultPath: suggestName(options.fileName, "html"),
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
    bytes: new TextEncoder().encode(document.fullHtml),
  });
  return {
    path: saved.path,
    fileName: saved.fileName,
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
  const bundle = buildHtmlAssetsBundle(document, baseName);
  const htmlPath = await pickExportPath({
    defaultPath: bundle.htmlPathSuggestedName,
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
  if (!htmlPath) {
    throw new ExportCancelledError();
  }
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

async function exportPdf(
  options: RunExportOptions,
  title: string,
  _baseName: string,
): Promise<RunExportResult> {
  const exportDoc = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: true,
  });

  const host = window.document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;width:920px;background:#fff;pointer-events:none;opacity:0;";
  host.innerHTML = `<style>${exportDoc.css}</style><article class="markdown-body export-root">${exportDoc.bodyHtml}</article>`;
  window.document.body.appendChild(host);

  try {
    await waitForImages(host);
    const article = host.querySelector(".export-root") as HTMLElement | null;
    if (!article) {
      throw new ExportFailedError("无法构建 PDF 导出节点");
    }
    const widthPx = Math.max(EXPORT_CONTENT_WIDTH_PX, article.scrollWidth || EXPORT_CONTENT_WIDTH_PX);
    const heightPx = Math.max(article.scrollHeight, 1);

    const { createRenderer } = await import("@imggion/html2realpdf");
    const fonts = await loadExportFonts();
    const renderer = await createRenderer({
      fonts,
      execution: "main",
    });
    try {
      const pdf = await renderer.render(article, {
        cssProfile: "web",
        unsupportedCss: "warn",
        page: {
          format: [widthPx, heightPx],
          unit: "px",
          margin: 0,
        },
        metadata: {
          title,
          creator: "tomark",
        },
      });
      try {
        if (pdf.pageCount !== 1) {
          throw new ExportFailedError(
            `PDF 未能以单页长页导出（实际 ${pdf.pageCount} 页）。已中止，避免分页或位图回退。`,
          );
        }
        const bytes = pdf.toUint8Array();
        const saved = await saveBytesWithDialog({
          defaultPath: suggestName(options.fileName, "pdf"),
          filters: [{ name: "PDF", extensions: ["pdf"] }],
          bytes,
        });
        return {
          path: saved.path,
          fileName: saved.fileName,
          warnings: exportDoc.warnings,
        };
      } finally {
        pdf.dispose();
      }
    } finally {
      renderer.dispose();
    }
  } finally {
    host.remove();
  }
}

async function exportDocx(
  options: RunExportOptions,
  title: string,
  _baseName: string,
): Promise<RunExportResult> {
  const exportDoc = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: true,
  });
  const fullHtml = wrapExportHtml({
    title,
    bodyHtml: exportDoc.bodyHtml,
    css: exportShellCss(),
  });

  const HTMLtoDOCX = (await import("@turbodocx/html-to-docx")).default;
  const result = await HTMLtoDOCX(fullHtml, null, {
    title,
    creator: "tomark",
    font: "Source Han Sans SC",
    fontSize: 22,
    margins: {
      top: 720,
      right: 720,
      bottom: 720,
      left: 720,
    },
  });

  const bytes = await normalizeGeneratedBytes(result);
  if (!bytes) {
    throw new ExportFailedError("DOCX 生成结果无效");
  }

  const saved = await saveBytesWithDialog({
    defaultPath: suggestName(options.fileName, "docx"),
    filters: [{ name: "Word", extensions: ["docx"] }],
    bytes,
  });
  return {
    path: saved.path,
    fileName: saved.fileName,
    warnings: exportDoc.warnings,
  };
}

async function exportPng(
  options: RunExportOptions,
  title: string,
  _baseName: string,
): Promise<RunExportResult> {
  const exportDoc = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: true,
  });

  const host = window.document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;width:920px;background:#fff;pointer-events:none;opacity:0;";
  host.innerHTML = `<style>${exportDoc.css}</style><article class="markdown-body export-root">${exportDoc.bodyHtml}</article>`;
  window.document.body.appendChild(host);

  try {
    await waitForImages(host);
    const article = host.querySelector(".export-root") as HTMLElement | null;
    if (!article) {
      throw new ExportFailedError("无法构建 PNG 导出节点");
    }

    const width = Math.max(article.scrollWidth, EXPORT_CONTENT_WIDTH_PX);
    const height = Math.max(article.scrollHeight, 1);
    const scale = computeExportPngScale(width, height);
    const note =
      scale < 2
        ? `长图已按 ${scale.toFixed(2)}x 降采样，以避免超出画布上限。`
        : undefined;

    const html2canvas = (await import("html2canvas")).default;
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
      throw new ExportFailedError("PNG 编码失败");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const saved = await saveBytesWithDialog({
      defaultPath: suggestName(options.fileName, "png"),
      filters: [{ name: "PNG", extensions: ["png"] }],
      bytes,
    });
    return {
      path: saved.path,
      fileName: saved.fileName,
      warnings: exportDoc.warnings,
      note,
    };
  } finally {
    host.remove();
  }
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
      "文档过长，无法在画布限制内导出 PNG。请改用 PDF 或 HTML。",
    );
  }
  return scale;
}

async function normalizeGeneratedBytes(result: unknown): Promise<Uint8Array | null> {
  if (result instanceof ArrayBuffer) {
    return new Uint8Array(result);
  }
  if (typeof Blob !== "undefined" && result instanceof Blob) {
    return new Uint8Array(await result.arrayBuffer());
  }
  // html-to-docx may return a Buffer/Uint8Array from another realm where
  // `instanceof Uint8Array` fails; ArrayBuffer.isView covers that case.
  if (ArrayBuffer.isView(result)) {
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  }
  return null;
}

function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
}

let fontCache:
  | {
      family: string;
      data: ArrayBuffer;
      weight: number;
      style: "normal";
    }[]
  | null = null;

async function loadExportFonts() {
  if (fontCache) {
    return fontCache;
  }
  // Prefer TrueType (VF). CFF/OTF may be rejected by the PDF renderer.
  const fontUrl = new URL("../assets/fonts/SourceHanSansSC-VF.ttf", import.meta.url);
  const response = await fetch(fontUrl);
  if (!response.ok) {
    throw new ExportFailedError("缺少中文字体 SourceHanSansSC-VF.ttf");
  }
  const data = await response.arrayBuffer();
  fontCache = [
    {
      family: "Source Han Sans SC",
      data,
      weight: 400,
      style: "normal",
    },
    {
      family: "Source Han Sans SC",
      data: data.slice(0),
      weight: 700,
      style: "normal",
    },
  ];
  return fontCache;
}
