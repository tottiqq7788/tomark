export type ExportFormatId =
  | "pdf"
  | "html-embedded"
  | "html-assets"
  | "docx"
  | "png";

export interface ImageWarning {
  src: string;
  reason: string;
}

export interface ResolvedImage {
  originalSrc: string;
  /** Absolute URL or data URL used in embedded exports. */
  dataUrl: string;
  /** Preferred file extension without leading dot, e.g. png. */
  extension: string;
  /** Raw bytes when available (local / fetched). */
  bytes?: Uint8Array;
  /** Suggested asset filename for resource-directory HTML. */
  assetName?: string;
}

export interface ImageResolutionResult {
  html: string;
  images: ResolvedImage[];
  warnings: ImageWarning[];
}

export interface ExportDocumentOptions {
  title: string;
  markdownSource: string;
  documentPath?: string | null;
  /** Prefer data URLs for every img src. */
  embedImages: boolean;
}

export interface BuiltExportDocument {
  title: string;
  bodyHtml: string;
  fullHtml: string;
  css: string;
  warnings: ImageWarning[];
  images: ResolvedImage[];
}

export interface HtmlAssetsBundle {
  htmlPathSuggestedName: string;
  htmlContent: string;
  assetsDirName: string;
  assets: { relativePath: string; bytes: Uint8Array; mimeType: string }[];
  warnings: ImageWarning[];
}

export class ExportCancelledError extends Error {
  constructor(message = "已取消导出") {
    super(message);
    this.name = "ExportCancelledError";
  }
}

export class ExportFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportFailedError";
  }
}

export const EXPORT_CONTENT_WIDTH_PX = 920;
