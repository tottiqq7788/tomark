import markdownBodyCss from "@/preview/markdownBody.css?raw";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import { renderMermaidForExport } from "@/preview/renderMermaid";
import {
  EXPORT_CONTENT_WIDTH_PX,
  ExportFailedError,
  PDF_PAGED_CONTENT_WIDTH_MM,
  type BuiltExportDocument,
  type ExportDocumentOptions,
  type HtmlAssetsBundle,
  type ImageResolutionResult,
  type ImageWarning,
  type ResolvedImage,
} from "./types";
import { resolveImagesInHtml } from "./resolveImages";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function defaultExportBaseName(fileName: string): string {
  const trimmed = fileName.trim() || "未命名";
  return trimmed.replace(/\.(md|markdown)$/i, "") || "未命名";
}

const EXPORT_BODY_FONT_STACK =
  '"Source Han Sans SC", "Noto Sans Symbols 2", "Noto Emoji", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif';

const EXPORT_CODE_FONT_STACK =
  '"Source Code Pro", "Source Han Sans SC", "Noto Sans Symbols 2", "Noto Emoji", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function exportShellCss(): string {
  return `${markdownBodyCss}

.export-root {
  box-sizing: border-box;
  width: ${EXPORT_CONTENT_WIDTH_PX}px;
  max-width: ${EXPORT_CONTENT_WIDTH_PX}px;
  margin: 0 auto;
  padding: 24px 28px 48px;
  background: #fff;
  color: #000000;
  font-family: ${EXPORT_BODY_FONT_STACK};
  font-size: 14px;
}

.export-root code,
.export-root pre,
.export-root kbd,
.export-root samp {
  font-family: ${EXPORT_CODE_FONT_STACK};
}

.export-root img {
  max-width: 100%;
  height: auto;
}

.export-image-warning {
  display: inline-block;
  padding: 2px 6px;
  border: 1px dashed #d1d5db;
  border-radius: 4px;
  color: #6b7280;
  font-size: 0.9em;
}
`;
}

/** Print-oriented shell for A4 vector pagination (margins owned by page.margin). */
export function exportPagedPdfCss(): string {
  return `${markdownBodyCss}

.export-root.export-root-paged {
  box-sizing: border-box;
  width: 100%;
  max-width: ${PDF_PAGED_CONTENT_WIDTH_MM}mm;
  margin: 0 auto;
  padding: 0;
  background: #fff;
  color: #000000;
  font-family: ${EXPORT_BODY_FONT_STACK};
  font-size: 11pt;
  line-height: 1.55;
}

.export-root.export-root-paged code,
.export-root.export-root-paged pre,
.export-root.export-root-paged kbd,
.export-root.export-root-paged samp {
  font-family: ${EXPORT_CODE_FONT_STACK};
}

.export-root.export-root-paged img,
.export-root.export-root-paged svg,
.export-root.export-root-paged canvas {
  max-width: 100%;
  height: auto;
}

.export-root.export-root-paged h1,
.export-root.export-root-paged h2,
.export-root.export-root-paged h3,
.export-root.export-root-paged h4,
.export-root.export-root-paged h5,
.export-root.export-root-paged h6 {
  break-after: avoid;
  page-break-after: avoid;
}

.export-root.export-root-paged thead,
.export-root.export-root-paged tr {
  break-inside: avoid;
  page-break-inside: avoid;
}

.export-root.export-root-paged .pdf-atomic,
.export-root.export-root-paged figure.pdf-atomic {
  break-inside: avoid;
  page-break-inside: avoid;
}

.export-root.export-root-paged .pdf-flow {
  break-inside: auto;
  page-break-inside: auto;
}

.export-root.export-root-paged figcaption {
  margin-top: 0.35em;
  color: #333333;
  font-size: 0.92em;
}
`;
}

export function wrapExportHtml(options: {
  title: string;
  bodyHtml: string;
  css?: string;
}): string {
  const css = options.css ?? exportShellCss();
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title)}</title>
  <style>
${css}
  </style>
</head>
<body>
  <article class="markdown-body export-root">
${options.bodyHtml}
  </article>
</body>
</html>
`;
}

export async function buildExportDocument(
  options: ExportDocumentOptions,
): Promise<BuiltExportDocument> {
  const rendered = renderMarkdown(options.markdownSource, { mode: "export" });
  const resolved: ImageResolutionResult = await resolveImagesInHtml(
    rendered.html,
    {
      documentPath: options.documentPath ?? null,
      mode: options.embedImages ? "embed" : "assets",
      baseName: defaultExportBaseName(options.title),
    },
  );

  const bodyHtml = await hydrateExportMermaid(resolved.html);

  const fullHtml = wrapExportHtml({
    title: options.title,
    bodyHtml,
  });

  return {
    title: options.title,
    bodyHtml,
    fullHtml,
    css: exportShellCss(),
    warnings: resolved.warnings,
    images: resolved.images,
  };
}

/** Replace mermaid fences with SVG in a connected DOM host when available. */
async function hydrateExportMermaid(bodyHtml: string): Promise<string> {
  if (
    typeof window === "undefined" ||
    !window.document?.body ||
    !bodyHtml.includes("language-mermaid")
  ) {
    return bodyHtml;
  }

  const host = window.document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${EXPORT_CONTENT_WIDTH_PX}px;overflow:hidden;visibility:hidden;pointer-events:none;`;
  host.setAttribute("aria-hidden", "true");
  host.innerHTML = bodyHtml;
  window.document.body.appendChild(host);
  try {
    const failures = await renderMermaidForExport(host);
    if (failures.length > 0) {
      throw new ExportFailedError(
        `Mermaid 图表渲染失败：${failures[0]}`,
      );
    }
    return host.innerHTML;
  } finally {
    host.remove();
  }
}

export function buildHtmlAssetsBundle(
  document: BuiltExportDocument,
  baseName: string,
): HtmlAssetsBundle {
  const assetsDirName = `${baseName}_files`;
  const assets: HtmlAssetsBundle["assets"] = [];
  const warnings: ImageWarning[] = [...document.warnings];
  let html = document.bodyHtml;

  for (const image of document.images) {
    if (!image.bytes || !image.assetName) {
      continue;
    }
    const assetHref = `${assetsDirName}/${image.assetName}`;
    assets.push({
      relativePath: image.assetName,
      bytes: image.bytes,
      mimeType: mimeFromExtension(image.extension),
    });
    html = replaceImgSrc(html, image.originalSrc, assetHref);
  }

  return {
    htmlPathSuggestedName: `${baseName}.html`,
    htmlContent: wrapExportHtml({ title: document.title, bodyHtml: html }),
    assetsDirName,
    assets,
    warnings,
  };
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

function mimeFromExtension(extension: string): string {
  switch (extension.toLowerCase()) {
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

export type { ResolvedImage };
