import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportDocument, wrapExportHtml, exportShellCss } from "@/export/buildExportHtml";

const fixtureMarkdown = readFileSync(
  path.join(process.cwd(), "tests/fixtures/export-smoke.md"),
  "utf8",
);

describe("real format generators (no mocks)", () => {
  it("produces a zip-based DOCX from the smoke fixture", async () => {
    const document = await buildExportDocument({
      title: "export-smoke",
      markdownSource: fixtureMarkdown,
      documentPath: null,
      embedImages: true,
    });
    const fullHtml = wrapExportHtml({
      title: document.title,
      bodyHtml: document.bodyHtml,
      css: exportShellCss(),
    });
    const HTMLtoDOCX = (await import("@turbodocx/html-to-docx")).default;
    const result = await HTMLtoDOCX(fullHtml, null, {
      title: "export-smoke",
      creator: "tomark",
      font: "Source Han Sans SC",
      fontSize: 22,
    });
    expect(ArrayBuffer.isView(result)).toBe(true);
    const view = result as ArrayBufferView;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    // DOCX is a ZIP container.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  }, 30_000);
});
