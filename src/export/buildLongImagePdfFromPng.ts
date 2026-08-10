import { PDFDocument } from "pdf-lib";
import { ExportFailedError } from "./types";

/** CSS reference DPI → PDF user-space points (1/72"). */
const CSS_PX_TO_PDF_PT = 72 / 96;

/**
 * Common PDF readers reject pages larger than ~200 inches (14_400 pt).
 * Clamp while preserving aspect ratio so ultra-long docs still open.
 */
export const MAX_PDF_PAGE_DIMENSION_PT = 14_400;

export interface LongImagePdfLayout {
  /** Layout width of the export article in CSS pixels (before raster scale). */
  cssWidthPx: number;
  /** Layout height of the export article in CSS pixels (before raster scale). */
  cssHeightPx: number;
}

export interface LongImagePdfSlice {
  pngBytes: Uint8Array;
  /** Slice height in CSS pixels (matches the html2canvas crop). */
  cssHeightPx: number;
}

export function computeLongImagePdfPageSize(
  layout: LongImagePdfLayout,
): { widthPt: number; heightPt: number; layoutScale: number } {
  const cssWidth = Math.max(1, layout.cssWidthPx);
  const cssHeight = Math.max(1, layout.cssHeightPx);
  let widthPt = cssWidth * CSS_PX_TO_PDF_PT;
  let heightPt = cssHeight * CSS_PX_TO_PDF_PT;
  let layoutScale = 1;
  const maxSide = Math.max(widthPt, heightPt);
  if (maxSide > MAX_PDF_PAGE_DIMENSION_PT) {
    layoutScale = MAX_PDF_PAGE_DIMENSION_PT / maxSide;
    widthPt *= layoutScale;
    heightPt *= layoutScale;
  }
  return { widthPt, heightPt, layoutScale };
}

/**
 * Embed one or more vertical PNG slices as a single PDF page.
 * Text is not extractable.
 *
 * Page size follows CSS layout (96 CSS px = 72 pt). High raster scale on each
 * slice yields ~288–384 DPI without requiring one canvas for the full document.
 */
export async function buildLongImagePdfFromSlices(
  slices: LongImagePdfSlice[],
  cssWidthPx: number,
): Promise<Uint8Array> {
  if (slices.length === 0) {
    throw new ExportFailedError("PDF 编码失败：没有可用的长图分片");
  }
  const cssHeightPx = slices.reduce((sum, slice) => sum + slice.cssHeightPx, 0);
  try {
    const pdfDoc = await PDFDocument.create();
    const { widthPt, heightPt, layoutScale } = computeLongImagePdfPageSize({
      cssWidthPx,
      cssHeightPx,
    });
    const page = pdfDoc.addPage([widthPt, heightPt]);
    let cursorY = heightPt;
    for (const slice of slices) {
      const image = await pdfDoc.embedPng(slice.pngBytes);
      const sliceHeightPt =
        Math.max(1, slice.cssHeightPx) * CSS_PX_TO_PDF_PT * layoutScale;
      cursorY -= sliceHeightPt;
      page.drawImage(image, {
        x: 0,
        y: cursorY,
        width: widthPt,
        height: sliceHeightPt,
      });
    }
    const saved = await pdfDoc.save();
    return saved instanceof Uint8Array ? saved : new Uint8Array(saved);
  } catch (error) {
    if (error instanceof ExportFailedError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ExportFailedError(`PDF 编码失败：${message}`);
  }
}

/** @deprecated Prefer {@link buildLongImagePdfFromSlices}; kept for single-buffer callers. */
export async function buildLongImagePdfFromPng(
  pngBytes: Uint8Array,
  layout: LongImagePdfLayout,
): Promise<Uint8Array> {
  return buildLongImagePdfFromSlices(
    [{ pngBytes, cssHeightPx: layout.cssHeightPx }],
    layout.cssWidthPx,
  );
}
