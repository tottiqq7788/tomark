import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  MAX_PDF_PAGE_DIMENSION_PT,
  buildLongImagePdfFromPng,
  buildLongImagePdfFromSlices,
  computeLongImagePdfPageSize,
} from "@/export/buildLongImagePdfFromPng";
import { ExportFailedError } from "@/export/types";

const ONE_BY_ONE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("buildLongImagePdfFromPng", () => {
  it("sizes the page from CSS layout so raster scale raises effective DPI", async () => {
    const cssWidthPx = 920;
    const cssHeightPx = 1200;
    const pdfBytes = await buildLongImagePdfFromPng(ONE_BY_ONE_PNG, {
      cssWidthPx,
      cssHeightPx,
    });
    expect(pdfBytes[0]).toBe(0x25); // %
    expect(pdfBytes[1]).toBe(0x50); // P
    expect(pdfBytes[2]).toBe(0x44); // D
    expect(pdfBytes[3]).toBe(0x46); // F

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    const { width, height } = page.getSize();
    expect(width).toBeCloseTo(cssWidthPx * (72 / 96), 5);
    expect(height).toBeCloseTo(cssHeightPx * (72 / 96), 5);
  });

  it("stacks vertical slices onto one page preserving total CSS height", async () => {
    const pdfBytes = await buildLongImagePdfFromSlices(
      [
        { pngBytes: ONE_BY_ONE_PNG, cssHeightPx: 400 },
        { pngBytes: ONE_BY_ONE_PNG, cssHeightPx: 500 },
      ],
      920,
    );
    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(920 * (72 / 96), 5);
    expect(height).toBeCloseTo(900 * (72 / 96), 5);
  });

  it("clamps ultra-tall pages to the common PDF reader limit", () => {
    const { widthPt, heightPt } = computeLongImagePdfPageSize({
      cssWidthPx: 920,
      cssHeightPx: 100_000,
    });
    expect(Math.max(widthPt, heightPt)).toBeLessThanOrEqual(
      MAX_PDF_PAGE_DIMENSION_PT,
    );
    expect(heightPt / widthPt).toBeCloseTo(100_000 / 920, 5);
  });

  it("rejects invalid png bytes", async () => {
    await expect(
      buildLongImagePdfFromPng(new Uint8Array([0x00, 0x01, 0x02]), {
        cssWidthPx: 10,
        cssHeightPx: 10,
      }),
    ).rejects.toBeInstanceOf(ExportFailedError);
  });

  it("does not double-wrap an ExportFailedError from embedPng", async () => {
    const original = PDFDocument.prototype.embedPng;
    PDFDocument.prototype.embedPng = vi.fn(async () => {
      throw new ExportFailedError("上游已失败");
    }) as typeof original;
    try {
      await expect(
        buildLongImagePdfFromPng(ONE_BY_ONE_PNG, {
          cssWidthPx: 10,
          cssHeightPx: 10,
        }),
      ).rejects.toSatisfy(
        (error: unknown) =>
          error instanceof ExportFailedError &&
          error.message === "上游已失败" &&
          !error.message.startsWith("PDF 编码失败："),
      );
    } finally {
      PDFDocument.prototype.embedPng = original;
    }
  });
});
