import {
  buildExportDocument,
  buildHtmlAssetsBundle,
  defaultExportBaseName,
  exportPagedPdfCss,
  exportShellCss,
  wrapExportHtml,
} from "./buildExportHtml";
import {
  findMissingGlyphs,
  formatMissingGlyphError,
  FontCoverage,
  parseFontCoverage,
} from "./fontCoverage";
import {
  EXPORT_CONTENT_WIDTH_PX,
  ExportCancelledError,
  ExportFailedError,
  PDF_PAGED_CONTENT_HEIGHT_MM,
  PDF_PAGED_CONTENT_WIDTH_MM,
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
import { Buffer as BrowserBuffer } from "buffer";

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

export type ExportFontFace = {
  family: string;
  data: ArrayBuffer;
  weight: number;
  style: "normal";
};

export type PdfLayoutMode = "long" | "paged";
export type ExportRendererId = "pdf" | "docx" | "png";

/** Approximate CSS px per mm at 96dpi for measuring against A4 content box. */
const CSS_PX_PER_MM = 96 / 25.4;

export const PDF_PAGED_CONTENT_HEIGHT_PX = Math.floor(
  PDF_PAGED_CONTENT_HEIGHT_MM * CSS_PX_PER_MM,
);

function suggestName(fileName: string, extension: string): string {
  return `${defaultExportBaseName(fileName)}.${extension}`;
}

function suggestPagedPdfName(fileName: string): string {
  return `${defaultExportBaseName(fileName)}-分页.pdf`;
}

function ensureBrowserGlobals(): void {
  const root = globalThis as typeof globalThis & { global?: typeof globalThis };
  if (root.global === undefined) {
    root.global = root;
  }
}

function loadPdfRenderer() {
  return import("@imggion/html2realpdf");
}

function loadDocxRenderer() {
  return import("@turbodocx/html-to-docx");
}

function loadPngRenderer() {
  return import("html2canvas");
}

/** Load lazy export engines without rendering; used by the browser smoke test. */
export async function preloadExportRenderer(
  renderer: ExportRendererId,
): Promise<void> {
  ensureBrowserGlobals();
  switch (renderer) {
    case "pdf":
      await loadPdfRenderer();
      return;
    case "docx":
      await loadDocxRenderer();
      return;
    case "png":
      await loadPngRenderer();
      return;
  }
}

/** Explicit same-origin WASM URL under Vite `src/` root (never `/@fs/...`). */
export function resolvePdfWasmUrl(): string {
  return new URL("../assets/pdf/libhtml2realpdf.wasm", import.meta.url).href;
}

export async function runExport(
  options: RunExportOptions,
): Promise<RunExportResult> {
  ensureBrowserGlobals();
  const baseName = defaultExportBaseName(options.fileName);
  const title = baseName;

  switch (options.format) {
    case "html-embedded":
      return exportEmbeddedHtml(options, title, baseName);
    case "html-assets":
      return exportAssetsHtml(options, title, baseName);
    case "pdf":
      return exportPdf(options, title, "long");
    case "pdf-paged":
      return exportPdf(options, title, "paged");
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
  const targetPath = await resolveExportTargetPath(options, {
    defaultPath: suggestName(options.fileName, "html"),
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
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
  const htmlPath = await resolveExportTargetPath(options, {
    defaultPath: suggestName(options.fileName, "html"),
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
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

async function exportPdf(
  options: RunExportOptions,
  title: string,
  layout: PdfLayoutMode,
): Promise<RunExportResult> {
  const targetPath = await resolveExportTargetPath(options, {
    defaultPath:
      layout === "paged"
        ? suggestPagedPdfName(options.fileName)
        : suggestName(options.fileName, "pdf"),
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });

  reportProgress(options, "正在准备文档…");
  await yieldToUi();
  const exportDoc = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: true,
  });

  const css = layout === "paged" ? exportPagedPdfCss() : exportDoc.css;
  const rootClass =
    layout === "paged"
      ? "markdown-body export-root export-root-paged"
      : "markdown-body export-root";
  const hostWidth =
    layout === "paged"
      ? `${PDF_PAGED_CONTENT_WIDTH_MM}mm`
      : `${EXPORT_CONTENT_WIDTH_PX}px`;

  const host = window.document.createElement("div");
  // Keep the host in the layout viewport with real dimensions. Far off-screen /
  // opacity:0 hosts can stall html2realpdf page layout inside WKWebView.
  host.style.cssText = `position:fixed;left:0;top:0;width:${hostWidth};visibility:hidden;pointer-events:none;z-index:-1;background:#fff;`;
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = `<style>${css}</style><article class="${rootClass}">${exportDoc.bodyHtml}</article>`;
  window.document.body.appendChild(host);

  try {
    await renderMermaidForExport(host);
    await rasterizeMermaidDiagrams(host, false);
    await waitForExportImages(host);
    const article = host.querySelector(".export-root") as HTMLElement | null;
    if (!article) {
      throw new ExportFailedError("无法构建 PDF 导出节点");
    }

    // Form controls are not font-backed text; html2realpdf raises MissingGlyph.
    replaceTaskListCheckboxes(article);
    if (layout === "paged") {
      preparePagedExportDom(article);
    }

    reportProgress(options, "正在加载字体…");
    await yieldToUi();
    const { fonts, coverage } = await loadExportFonts();
    assertPdfTextCovered(article.textContent ?? "", coverage, options.markdownSource);

    reportProgress(
      options,
      layout === "paged" ? "正在渲染分页 PDF…" : "正在渲染长页 PDF…",
    );
    await yieldToUi();
    const { createRenderer } = await loadPdfRenderer();
    const wasmUrl = resolvePdfWasmUrl();
    const execution = pdfExecutionBackend();
    const renderer = await createRenderer({
      fonts,
      execution,
      wasmUrl,
    });
    try {
      const renderOptions =
        layout === "paged"
          ? buildPagedPdfRenderOptions(title)
          : buildLongPdfRenderOptions(title, article);
      const renderController = new AbortController();
      const renderPromise = renderer.render(article, {
        ...renderOptions,
        signal: renderController.signal,
      });
      const pdf =
        execution === "worker"
          ? await withTimeout(
              renderPromise,
              layout === "paged" ? 120_000 : 90_000,
              layout === "paged"
                ? "分页 PDF 渲染超时（可能是 WebView 布局卡住）。请重试；若仍失败请反馈。"
                : "长页 PDF 渲染超时。请重试；若仍失败请反馈。",
              () => renderController.abort(),
            )
          : await renderPromise;
      try {
        if (layout === "long" && pdf.pageCount !== 1) {
          throw new ExportFailedError(
            `PDF 未能以单页长页导出（实际 ${pdf.pageCount} 页）。已中止，避免分页或位图回退。`,
          );
        }
        if (layout === "paged" && pdf.pageCount < 1) {
          throw new ExportFailedError("PDF 分页导出未生成任何页面。");
        }
        const bytes = pdf.toUint8Array();
        const rasterizedCount = (pdf.diagnostics ?? []).filter(
          (diagnostic) => diagnostic.fallback === "rasterize-subtree",
        ).length;
        const notes = [
          layout === "paged" ? `共 ${pdf.pageCount} 页（A4 矢量分页）。` : "",
          rasterizedCount > 0
            ? `${rasterizedCount} 个不受支持的图形子树已栅格化。`
            : "",
        ].filter(Boolean);
        reportProgress(options, "正在写入文件…");
        await yieldToUi();
        await writeExportBytes(targetPath, bytes);
        return {
          path: targetPath,
          fileName: fileNameFromPath(targetPath),
          warnings: exportDoc.warnings,
          note: notes.length > 0 ? notes.join(" ") : undefined,
        };
      } finally {
        pdf.dispose();
      }
    } catch (error) {
      throw mapPdfRenderError(error, options.markdownSource);
    } finally {
      renderer.dispose();
    }
  } finally {
    host.remove();
  }
}

function pdfExecutionBackend(): "worker" | "main" {
  const userAgent = window.navigator.userAgent;
  const isWebKit = /AppleWebKit/i.test(userAgent);
  const isChromium = /(Chrome|Chromium|Edg)\//i.test(userAgent);
  return isWebKit && !isChromium ? "main" : "worker";
}

/** Let Vue paint status-bar updates before the next heavy synchronous stretch. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      onTimeout?.();
      reject(new ExportFailedError(message));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function buildLongPdfRenderOptions(title: string, article: HTMLElement) {
  const widthPx = Math.max(
    EXPORT_CONTENT_WIDTH_PX,
    article.scrollWidth || EXPORT_CONTENT_WIDTH_PX,
  );
  const heightPx = Math.max(article.scrollHeight, 1);
  return {
    cssProfile: "web" as const,
    unsupportedCss: "warn" as const,
    fallback: "rasterize-subtree" as const,
    page: {
      format: [widthPx, heightPx] as [number, number],
      unit: "px" as const,
      margin: 0,
    },
    metadata: {
      title,
      creator: "tomark",
    },
  };
}

function buildPagedPdfRenderOptions(title: string) {
  return {
    cssProfile: "web" as const,
    unsupportedCss: "warn" as const,
    fallback: "rasterize-subtree" as const,
    mediaType: "print" as const,
    layoutContext: "page" as const,
    viewport: {
      width: Math.round(PDF_PAGED_CONTENT_WIDTH_MM * CSS_PX_PER_MM),
      height: PDF_PAGED_CONTENT_HEIGHT_PX,
    },
    page: {
      format: "a4" as const,
      orientation: "portrait" as const,
      unit: "mm" as const,
      // html2realpdf margin order: [top, left, bottom, right]
      margin: [12, 13, 12, 13] as [number, number, number, number],
    },
    pageBreak: {
      avoid: [
        ".pdf-atomic",
        "figure.pdf-atomic",
        "thead",
        "tr",
      ],
      legacy: false,
    },
    metadata: {
      title,
      creator: "tomark",
    },
  };
}

/**
 * Replace GFM task-list checkboxes with covered Unicode markers.
 * html2realpdf paints native form controls and fails with MissingGlyph even
 * when body fonts cover every visible text character.
 * Exported for unit tests.
 */
export function replaceTaskListCheckboxes(root: HTMLElement): void {
  for (const input of Array.from(
    root.querySelectorAll('input[type="checkbox"]'),
  )) {
    if (!(input instanceof HTMLInputElement)) {
      continue;
    }
    const marker = window.document.createElement("span");
    marker.className = "pdf-task-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = input.checked ? "☑ " : "☐ ";
    input.replaceWith(marker);
  }
}

/**
 * Annotate DOM for paged PDF: keep images/captions and short blocks atomic,
 * let tall code/tables flow, and shrink oversized images into one page.
 * Exported for unit tests.
 */
export function preparePagedExportDom(root: HTMLElement): void {
  wrapStandaloneImages(root);
  markAtomicBlocks(root);
  shrinkOversizedMedia(root);
}

function wrapStandaloneImages(root: HTMLElement): void {
  const paragraphs = Array.from(root.querySelectorAll("p"));
  for (const paragraph of paragraphs) {
    if (!(paragraph instanceof HTMLElement)) {
      continue;
    }
    const images = Array.from(paragraph.querySelectorAll(":scope > img"));
    if (images.length === 0) {
      continue;
    }
    const text = (paragraph.textContent ?? "").replace(/\s+/g, "");
    const onlyImages =
      images.length > 0 &&
      Array.from(paragraph.childNodes).every((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return !(node.textContent ?? "").trim();
        }
        return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "IMG";
      });
    if (!onlyImages && text.length > 0) {
      continue;
    }

    const figure = window.document.createElement("figure");
    figure.className = "pdf-atomic";
    paragraph.replaceWith(figure);
    for (const image of images) {
      figure.appendChild(image);
    }

    const next = figure.nextElementSibling;
    if (
      next &&
      next.tagName === "P" &&
      !next.querySelector("img") &&
      (next.textContent ?? "").trim().length > 0 &&
      (next.textContent ?? "").trim().length < 160
    ) {
      const caption = window.document.createElement("figcaption");
      while (next.firstChild) {
        caption.appendChild(next.firstChild);
      }
      next.remove();
      figure.appendChild(caption);
    }
  }

  for (const image of Array.from(root.querySelectorAll("img"))) {
    if (image.closest("figure.pdf-atomic")) {
      continue;
    }
    const parent = image.parentElement;
    if (!parent || parent === root) {
      const figure = window.document.createElement("figure");
      figure.className = "pdf-atomic";
      image.replaceWith(figure);
      figure.appendChild(image);
    }
  }
}

function markAtomicBlocks(root: HTMLElement): void {
  const maxAtomicHeight = PDF_PAGED_CONTENT_HEIGHT_PX * 0.92;
  for (const el of Array.from(root.querySelectorAll("pre, blockquote, table"))) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    if (el.tagName === "TABLE") {
      // Rows stay atomic via CSS; the table itself may fragment.
      el.classList.add("pdf-flow");
      continue;
    }
    if (el.scrollHeight <= maxAtomicHeight) {
      el.classList.add("pdf-atomic");
    } else {
      el.classList.add("pdf-flow");
    }
  }

  for (const el of Array.from(root.querySelectorAll("svg, canvas, .export-diagram, .export-chart"))) {
    if (!(el instanceof HTMLElement)) {
      continue;
    }
    const target =
      el.closest("figure, p, div") instanceof HTMLElement
        ? (el.closest("figure, p, div") as HTMLElement)
        : el;
    if (target.scrollHeight <= maxAtomicHeight) {
      target.classList.add("pdf-atomic");
    } else {
      target.classList.add("pdf-flow");
      scaleElementToFit(el, maxAtomicHeight);
    }
  }
}

function shrinkOversizedMedia(root: HTMLElement): void {
  const maxHeight = PDF_PAGED_CONTENT_HEIGHT_PX * 0.92;
  for (const image of Array.from(root.querySelectorAll("img"))) {
    if (!(image instanceof HTMLImageElement)) {
      continue;
    }
    if (image.scrollHeight > maxHeight || image.naturalHeight * (image.clientWidth / Math.max(image.naturalWidth, 1)) > maxHeight) {
      scaleElementToFit(image, maxHeight);
    }
  }
}

function scaleElementToFit(el: HTMLElement, maxHeightPx: number): void {
  const height = el.scrollHeight || el.getBoundingClientRect().height;
  if (height <= maxHeightPx || height <= 0) {
    return;
  }
  const scale = maxHeightPx / height;
  el.style.maxHeight = `${Math.floor(maxHeightPx)}px`;
  el.style.width = `${Math.max(1, Math.floor(100 * scale))}%`;
  el.style.height = "auto";
  el.style.objectFit = "contain";
}

async function exportDocx(
  options: RunExportOptions,
  title: string,
  _baseName: string,
): Promise<RunExportResult> {
  const targetPath = await resolveExportTargetPath(options, {
    defaultPath: suggestName(options.fileName, "docx"),
    filters: [{ name: "Word", extensions: ["docx"] }],
  });

  reportProgress(options, "正在生成 Word 文档…");
  const exportDoc = await buildExportDocument({
    title,
    markdownSource: options.markdownSource,
    documentPath: options.documentPath,
    embedImages: true,
  });
  const docxBodyHtml = await rasterizeMermaidForDocx(exportDoc.bodyHtml);
  const fullHtml = wrapExportHtml({
    title,
    bodyHtml: docxBodyHtml,
    css: exportShellCss(),
  });

  const bufferGlobal = globalThis as typeof globalThis & {
    Buffer?: typeof BrowserBuffer;
  };
  bufferGlobal.Buffer ??= BrowserBuffer;
  const HTMLtoDOCX = (await loadDocxRenderer()).default;
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

  reportProgress(options, "正在写入文件…");
  await writeExportBytes(targetPath, bytes);
  return {
    path: targetPath,
    fileName: fileNameFromPath(targetPath),
    warnings: exportDoc.warnings,
  };
}

async function rasterizeMermaidForDocx(bodyHtml: string): Promise<string> {
  if (!bodyHtml.includes('data-mermaid="1"')) {
    return bodyHtml;
  }

  const host = window.document.createElement("div");
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_CONTENT_WIDTH_PX}px;background:#fff;pointer-events:none;`;
  host.innerHTML = bodyHtml;
  window.document.body.appendChild(host);
  try {
    await rasterizeMermaidDiagrams(host, true);
    return host.innerHTML;
  } finally {
    host.remove();
  }
}

async function rasterizeMermaidDiagrams(
  root: HTMLElement,
  wrapInParagraph: boolean,
): Promise<void> {
  const diagrams = Array.from(
    root.querySelectorAll<HTMLElement>(".mermaid-diagram[data-mermaid='1']"),
  );
  if (diagrams.length === 0) {
    return;
  }

  const previousVisibility = root.style.visibility;
  const previousLeft = root.style.left;
  root.style.visibility = "visible";
  root.style.left = "-100000px";
  try {
    const html2canvas = (await loadPngRenderer()).default;
    for (const diagram of diagrams) {
      const canvas = await html2canvas(diagram, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      if (canvas.width < 1 || canvas.height < 1) {
        throw new Error("图表画布尺寸为零");
      }
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl.startsWith("data:image/png;base64,")) {
        throw new Error("图表 PNG 编码失败");
      }

      const image = window.document.createElement("img");
      image.src = dataUrl;
      image.alt = diagram.textContent?.trim() || "Mermaid diagram";
      image.width = Math.max(1, Math.round(canvas.width / 2));
      image.height = Math.max(1, Math.round(canvas.height / 2));
      image.style.maxWidth = "100%";
      image.style.height = "auto";
      if (wrapInParagraph) {
        const paragraph = window.document.createElement("p");
        paragraph.appendChild(image);
        diagram.replaceWith(paragraph);
      } else {
        image.className = "mermaid-diagram-rasterized";
        diagram.replaceWith(image);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExportFailedError(`无法栅格化 Mermaid 图表：${message}`);
  } finally {
    root.style.visibility = previousVisibility;
    root.style.left = previousLeft;
  }
}

async function exportPng(
  options: RunExportOptions,
  title: string,
  _baseName: string,
): Promise<RunExportResult> {
  const targetPath = await resolveExportTargetPath(options, {
    defaultPath: suggestName(options.fileName, "png"),
    filters: [{ name: "PNG", extensions: ["png"] }],
  });

  reportProgress(options, "正在生成长图…");
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
      throw new ExportFailedError("无法构建 PNG 导出节点");
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
      throw new ExportFailedError("PNG 编码失败");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    reportProgress(options, "正在写入文件…");
    await writeExportBytes(targetPath, bytes);
    return {
      path: targetPath,
      fileName: fileNameFromPath(targetPath),
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

type LoadedExportFonts = {
  fonts: ExportFontFace[];
  coverage: FontCoverage;
};

let fontCache: LoadedExportFonts | null = null;

const FONT_ASSETS: {
  file: string;
  family: string;
  weights: number[];
}[] = [
  {
    file: "SourceCodePro-Regular.ttf",
    family: "Source Code Pro",
    weights: [400],
  },
  {
    file: "SourceCodePro-Bold.ttf",
    family: "Source Code Pro",
    weights: [700],
  },
  {
    file: "SourceHanSansSC-VF.ttf",
    family: "Source Han Sans SC",
    // Variable font: register once per needed weight without cloning the 34MB buffer.
    weights: [400, 700],
  },
  {
    file: "NotoSansSymbols2-Regular.ttf",
    family: "Noto Sans Symbols 2",
    weights: [400],
  },
  {
    file: "NotoEmoji-Regular.ttf",
    family: "Noto Emoji",
    weights: [400],
  },
];

export async function loadExportFonts(): Promise<LoadedExportFonts> {
  if (fontCache) {
    return fontCache;
  }

  const fonts: ExportFontFace[] = [];
  const coverages: FontCoverage[] = [];

  for (const asset of FONT_ASSETS) {
    const fontUrl = new URL(`../assets/fonts/${asset.file}`, import.meta.url);
    const response = await fetch(fontUrl);
    if (!response.ok) {
      throw new ExportFailedError(`缺少导出字体 ${asset.file}`);
    }
    const data = await response.arrayBuffer();
    coverages.push(parseFontCoverage(data));
    for (const weight of asset.weights) {
      fonts.push({
        family: asset.family,
        data,
        weight,
        style: "normal",
      });
    }
  }

  fontCache = {
    fonts,
    coverage: FontCoverage.merge(coverages),
  };
  return fontCache;
}

/** Test helper to clear cached fonts between cases. */
export function resetExportFontCache(): void {
  fontCache = null;
}

export function assertPdfTextCovered(
  text: string,
  coverage: FontCoverage,
  markdownSource?: string,
): void {
  const hits = findMissingGlyphs(text, coverage, { markdownSource });
  if (hits.length > 0) {
    throw new ExportFailedError(formatMissingGlyphError(hits));
  }
}

function mapPdfRenderError(error: unknown, markdownSource: string): Error {
  if (error instanceof ExportFailedError || error instanceof ExportCancelledError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/MissingGlyph/i.test(message)) {
    const match = /U\+[0-9A-F]{4,6}/i.exec(message);
    const codeHint = match?.[0];
    const charHint = extractCharFromMissingGlyphMessage(message);
    if (charHint || codeHint) {
      const hits = findMissingGlyphs(charHint ?? "", FontCoverage.fromCodepoints([]), {
        markdownSource,
        limit: 1,
      });
      if (charHint && hits[0]) {
        return new ExportFailedError(formatMissingGlyphError(hits));
      }
      return new ExportFailedError(
        `PDF 字体未覆盖字符${charHint ? `「${charHint}」` : ""}${codeHint ? ` ${codeHint}` : ""}。无法以矢量可搜索文字导出。`,
      );
    }
    return new ExportFailedError(
      `PDF 渲染遇到未覆盖字形（MissingGlyph）。常见原因：任务列表复选框、生僻字、emoji 或符号。请检查后重试。原始错误：${message}`,
    );
  }
  return error instanceof Error ? error : new ExportFailedError(message);
}

function extractCharFromMissingGlyphMessage(message: string): string | null {
  const quoted = /[「『"'`](.+?)[」』"'`]/.exec(message);
  if (quoted?.[1]) {
    return quoted[1];
  }
  return null;
}
