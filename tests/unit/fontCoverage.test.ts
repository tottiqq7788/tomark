import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FontCoverage,
  findMissingGlyphs,
  formatMissingGlyphError,
  parseFontCoverage,
} from "@/export/fontCoverage";

const fontsDir = path.join(process.cwd(), "src/assets/fonts");

function loadFont(name: string): ArrayBuffer {
  const bytes = readFileSync(path.join(fontsDir, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("fontCoverage", () => {
  it("parses Source Code Pro and covers Latin code glyphs", () => {
    const coverage = parseFontCoverage(loadFont("SourceCodePro-Regular.ttf"));
    expect(coverage.has("A".codePointAt(0)!)).toBe(true);
    expect(coverage.has("你".codePointAt(0)!)).toBe(false);
  });

  it("parses Source Han Sans SC for Chinese body text", () => {
    const coverage = parseFontCoverage(loadFont("SourceHanSansSC-VF.ttf"));
    expect(coverage.has("中".codePointAt(0)!)).toBe(true);
    expect(coverage.has("文".codePointAt(0)!)).toBe(true);
  });

  it("parses Noto Emoji / Symbols for common pictographs", () => {
    const coverage = FontCoverage.merge([
      parseFontCoverage(loadFont("NotoSansSymbols2-Regular.ttf")),
      parseFontCoverage(loadFont("NotoEmoji-Regular.ttf")),
    ]);
    expect(coverage.has("😀".codePointAt(0)!)).toBe(true);
    expect(coverage.has("🚀".codePointAt(0)!)).toBe(true);
    expect(coverage.has("⚙".codePointAt(0)!)).toBe(true);
  });

  it("reports friendly missing glyph details with approximate line", () => {
    const coverage = FontCoverage.fromCodepoints([0x41]); // "A" only
    const markdown = "# title\n\nhello 𒀀 world";
    const hits = findMissingGlyphs("hello 𒀀 world", coverage, {
      markdownSource: markdown,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.hex).toMatch(/^U\+/);
    expect(hits[0]?.line).toBe(3);
    expect(formatMissingGlyphError(hits)).toContain("未覆盖");
    expect(formatMissingGlyphError(hits)).toContain("第 3 行");
  });
});
