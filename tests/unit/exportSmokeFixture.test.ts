import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildExportDocument, buildHtmlAssetsBundle } from "@/export/buildExportHtml";

const fixtureMarkdown = readFileSync(
  path.join(process.cwd(), "tests/fixtures/export-smoke.md"),
  "utf8",
);

describe("export smoke fixture", () => {
  it("builds embedded html with chinese, table, code, and data image", async () => {
    const document = await buildExportDocument({
      title: "export-smoke",
      markdownSource: fixtureMarkdown,
      documentPath: null,
      embedImages: true,
    });

    expect(document.fullHtml).toContain("<!DOCTYPE html>");
    expect(document.fullHtml).toContain("导出冒烟 Fixture");
    expect(document.fullHtml).toContain("<table>");
    expect(document.fullHtml).toContain("<pre>");
    expect(document.fullHtml).toContain("data:image/png;base64");
    expect(document.fullHtml).not.toContain("data-source-line");
    expect(document.warnings.some((warning) => warning.src.includes("missing-sample.png"))).toBe(
      true,
    );
  });

  it("builds movable html + assets directory bundle", async () => {
    const document = await buildExportDocument({
      title: "export-smoke",
      markdownSource: fixtureMarkdown,
      documentPath: null,
      embedImages: false,
    });
    const bundle = buildHtmlAssetsBundle(document, "export-smoke");
    expect(bundle.assetsDirName).toBe("export-smoke_files");
    expect(bundle.assets.length).toBeGreaterThan(0);
    expect(bundle.htmlContent).toContain('src="export-smoke_files/');
  });
});
