import markdownBodyCss from "@/preview/markdownBody.css?raw";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import {
  EXPORT_CONTENT_WIDTH_PX,
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

export function exportShellCss(): string {
  return `${markdownBodyCss}

.export-root {
  box-sizing: border-box;
  width: ${EXPORT_CONTENT_WIDTH_PX}px;
  max-width: ${EXPORT_CONTENT_WIDTH_PX}px;
  margin: 0 auto;
  padding: 24px 28px 48px;
  background: #fff;
  color: #1f2937;
  font-family: "Source Han Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI",
    Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei",
    sans-serif;
}

.export-root img {
  max-width: 100%;
  height: auto;
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

  const fullHtml = wrapExportHtml({
    title: options.title,
    bodyHtml: resolved.html,
  });

  return {
    title: options.title,
    bodyHtml: resolved.html,
    fullHtml,
    css: exportShellCss(),
    warnings: resolved.warnings,
    images: resolved.images,
  };
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
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(
    new RegExp(`(<img\\b[^>]*\\bsrc=["'])${escaped}(["'])`, "gi"),
    `$1${to}$2`,
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
