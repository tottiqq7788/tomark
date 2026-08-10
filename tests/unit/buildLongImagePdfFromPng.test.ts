import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildLongImagePdfFromPng } from "@/export/buildLongImagePdfFromPng";
import { ExportFailedError } from "@/export/types";

const ONE_BY_ONE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("buildLongImagePdfFromPng", () => {
  it("embeds a png as a single page matching image pixel size", async () => {
    const pdfBytes = await buildLongImagePdfFromPng(ONE_BY_ONE_PNG);
    expect(pdfBytes[0]).toBe(0x25); // %
    expect(pdfBytes[1]).toBe(0x50); // P
    expect(pdfBytes[2]).toBe(0x44); // D
    expect(pdfBytes[3]).toBe(0x46); // F

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBe(1);
    expect(height).toBe(1);
  });

  it("rejects invalid png bytes", async () => {
    await expect(
      buildLongImagePdfFromPng(new Uint8Array([0x00, 0x01, 0x02])),
    ).rejects.toBeInstanceOf(ExportFailedError);
  });
});
