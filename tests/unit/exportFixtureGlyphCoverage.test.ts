import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FontCoverage,
  findMissingGlyphs,
  parseFontCoverage,
} from "@/export/fontCoverage";
import { buildExportDocument } from "@/export/buildExportHtml";

const root = process.cwd();
const fontsDir = path.join(root, "src/assets/fonts");
const fixtureMarkdown = readFileSync(
  path.join(root, "tests/fixtures/export-smoke.md"),
  "utf8",
);

function loadFont(name: string): ArrayBuffer {
  const bytes = readFileSync(path.join(fontsDir, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("export smoke fixture glyph coverage", () => {
  it("covers chinese body, chinese code, emoji, and symbols used by the fixture", async () => {
    const coverage = FontCoverage.merge([
      parseFontCoverage(loadFont("SourceCodePro-Regular.ttf")),
      parseFontCoverage(loadFont("SourceCodePro-Bold.ttf")),
      parseFontCoverage(loadFont("SourceHanSansSC-VF.ttf")),
      parseFontCoverage(loadFont("NotoSansSymbols2-Regular.ttf")),
      parseFontCoverage(loadFont("NotoEmoji-Regular.ttf")),
    ]);

    const document = await buildExportDocument({
      title: "export-smoke",
      markdownSource: fixtureMarkdown,
      documentPath: null,
      embedImages: true,
    });

    // Approximate the PDF text extraction input: rendered body textContent.
    const host = document.bodyHtml.replace(/<[^>]+>/g, " ");
    const hits = findMissingGlyphs(`${host}\n${fixtureMarkdown}`, coverage, {
      markdownSource: fixtureMarkdown,
      limit: 20,
    });
    expect(hits).toEqual([]);
  });
});
