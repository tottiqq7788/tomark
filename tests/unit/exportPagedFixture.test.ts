import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportDocument, exportPagedPdfCss } from "@/export/buildExportHtml";
import { preparePagedExportDom } from "@/export/runExport";

const fixtureMarkdown = readFileSync(
  path.join(process.cwd(), "tests/fixtures/export-paged-pdf.md"),
  "utf8",
);

describe("export paged pdf fixture", () => {
  it("builds paged markup with chinese, emoji, table, code, and image caption pairing", async () => {
    const document = await buildExportDocument({
      title: "export-paged-pdf",
      markdownSource: fixtureMarkdown,
      documentPath: null,
      embedImages: true,
    });
    expect(document.bodyHtml).toContain("分页 PDF Fixture");
    expect(document.bodyHtml).toContain("😀");
    expect(document.bodyHtml).toContain("<table>");
    expect(document.bodyHtml).toContain("<pre>");
    expect(document.bodyHtml).toContain("<img");

    const host = window.document.createElement("article");
    host.className = "markdown-body export-root export-root-paged";
    host.innerHTML = document.bodyHtml;
    preparePagedExportDom(host);

    expect(host.querySelector("figure.pdf-atomic")).toBeTruthy();
    expect(host.querySelector("figure.pdf-atomic figcaption")?.textContent).toContain(
      "整块换页",
    );
    expect(host.querySelector("table")?.classList.contains("pdf-flow")).toBe(true);
    expect(exportPagedPdfCss()).toContain("break-inside: avoid");
  });
});
