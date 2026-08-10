import { PDFDocument } from "pdf-lib";
import { ExportFailedError } from "./types";

/**
 * Embed a full-height white-background PNG as a single PDF page.
 * Text is not extractable; page size matches the image pixel size in PDF points.
 */
export async function buildLongImagePdfFromPng(
  pngBytes: Uint8Array,
): Promise<Uint8Array> {
  try {
    const pdfDoc = await PDFDocument.create();
    const image = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
    const saved = await pdfDoc.save();
    return saved instanceof Uint8Array ? saved : new Uint8Array(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExportFailedError(`PDF 编码失败：${message}`);
  }
}
