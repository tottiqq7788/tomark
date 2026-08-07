/** Compact Unicode coverage built from TrueType/OpenType `cmap` tables. */

export type CodepointRange = readonly [start: number, end: number];

export class FontCoverage {
  private readonly ranges: CodepointRange[];

  constructor(ranges: CodepointRange[]) {
    this.ranges = normalizeRanges(ranges);
  }

  static fromCodepoints(codepoints: Iterable<number>): FontCoverage {
    const sorted = [...new Set(codepoints)].filter((cp) => cp > 0).sort((a, b) => a - b);
    const ranges: CodepointRange[] = [];
    for (const cp of sorted) {
      const last = ranges[ranges.length - 1];
      if (last && last[1] + 1 === cp) {
        ranges[ranges.length - 1] = [last[0], cp];
      } else {
        ranges.push([cp, cp]);
      }
    }
    return new FontCoverage(ranges);
  }

  static merge(coverages: FontCoverage[]): FontCoverage {
    return new FontCoverage(coverages.flatMap((coverage) => coverage.ranges));
  }

  has(codePoint: number): boolean {
    let lo = 0;
    let hi = this.ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const [start, end] = this.ranges[mid]!;
      if (codePoint < start) {
        hi = mid - 1;
      } else if (codePoint > end) {
        lo = mid + 1;
      } else {
        return true;
      }
    }
    return false;
  }

  toRanges(): CodepointRange[] {
    return [...this.ranges];
  }
}

export function parseFontCoverage(data: ArrayBuffer | Uint8Array): FontCoverage {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12) {
    throw new Error("字体文件过短，无法解析 cmap");
  }

  const numTables = view.getUint16(4, false);
  let cmapOffset = -1;
  let cmapLength = 0;
  for (let i = 0; i < numTables; i += 1) {
    const entry = 12 + i * 16;
    const tag = String.fromCharCode(
      bytes[entry]!,
      bytes[entry + 1]!,
      bytes[entry + 2]!,
      bytes[entry + 3]!,
    );
    if (tag === "cmap") {
      cmapOffset = view.getUint32(entry + 8, false);
      cmapLength = view.getUint32(entry + 12, false);
      break;
    }
  }
  if (cmapOffset < 0 || cmapOffset + cmapLength > bytes.byteLength) {
    throw new Error("字体缺少有效 cmap 表");
  }

  const cmap = new DataView(bytes.buffer, bytes.byteOffset + cmapOffset, cmapLength);
  const numEncodings = cmap.getUint16(2, false);
  type Encoding = { platform: number; encoding: number; offset: number };
  const encodings: Encoding[] = [];
  for (let i = 0; i < numEncodings; i += 1) {
    const base = 4 + i * 8;
    encodings.push({
      platform: cmap.getUint16(base, false),
      encoding: cmap.getUint16(base + 2, false),
      offset: cmap.getUint32(base + 4, false),
    });
  }

  const preference: Array<[number, number]> = [
    [3, 10],
    [0, 4],
    [0, 6],
    [3, 1],
    [0, 3],
    [0, 1],
  ];
  let chosen: Encoding | undefined;
  for (const [platform, encoding] of preference) {
    chosen = encodings.find((item) => item.platform === platform && item.encoding === encoding);
    if (chosen) {
      break;
    }
  }
  chosen ??= encodings[0];
  if (!chosen) {
    throw new Error("字体 cmap 无可用编码表");
  }

  const codepoints = collectCodepointsFromSubtable(cmap, chosen.offset);
  // Always treat ASCII whitespace / common controls used by markdown as covered.
  for (const cp of [0x09, 0x0a, 0x0d, 0x20]) {
    codepoints.add(cp);
  }
  return FontCoverage.fromCodepoints(codepoints);
}

function collectCodepointsFromSubtable(cmap: DataView, offset: number): Set<number> {
  const format = cmap.getUint16(offset, false);
  const out = new Set<number>();
  if (format === 4) {
    const segCount = cmap.getUint16(offset + 6, false) / 2;
    const endCountOffset = offset + 14;
    const startCountOffset = endCountOffset + 2 + segCount * 2;
    const idDeltaOffset = startCountOffset + segCount * 2;
    const idRangeOffsetOffset = idDeltaOffset + segCount * 2;
    for (let i = 0; i < segCount; i += 1) {
      const end = cmap.getUint16(endCountOffset + i * 2, false);
      const start = cmap.getUint16(startCountOffset + i * 2, false);
      const idDelta = cmap.getInt16(idDeltaOffset + i * 2, false);
      const idRangeOffset = cmap.getUint16(idRangeOffsetOffset + i * 2, false);
      for (let code = start; code <= end; code += 1) {
        let glyph = 0;
        if (idRangeOffset === 0) {
          glyph = (code + idDelta) & 0xffff;
        } else {
          const glyphIndexOffset =
            idRangeOffsetOffset +
            i * 2 +
            idRangeOffset +
            (code - start) * 2;
          if (glyphIndexOffset + 1 < cmap.byteLength) {
            const glyphId = cmap.getUint16(glyphIndexOffset, false);
            glyph = glyphId === 0 ? 0 : (glyphId + idDelta) & 0xffff;
          }
        }
        if (glyph !== 0) {
          out.add(code);
        }
      }
    }
    return out;
  }

  if (format === 12) {
    const nGroups = cmap.getUint32(offset + 12, false);
    for (let i = 0; i < nGroups; i += 1) {
      const base = offset + 16 + i * 12;
      const start = cmap.getUint32(base, false);
      const end = cmap.getUint32(base + 4, false);
      const startGlyph = cmap.getUint32(base + 8, false);
      for (let code = start; code <= end; code += 1) {
        if (startGlyph + (code - start) !== 0) {
          out.add(code);
        }
      }
    }
    return out;
  }

  if (format === 6) {
    const firstCode = cmap.getUint16(offset + 6, false);
    const entryCount = cmap.getUint16(offset + 8, false);
    for (let i = 0; i < entryCount; i += 1) {
      const glyph = cmap.getUint16(offset + 10 + i * 2, false);
      if (glyph !== 0) {
        out.add(firstCode + i);
      }
    }
    return out;
  }

  throw new Error(`暂不支持的 cmap 格式：${format}`);
}

function normalizeRanges(ranges: CodepointRange[]): CodepointRange[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges]
    .filter(([start, end]) => end >= start && end > 0)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: CodepointRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push(range);
      continue;
    }
    if (range[0] <= last[1] + 1) {
      merged[merged.length - 1] = [last[0], Math.max(last[1], range[1])];
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export interface MissingGlyphHit {
  char: string;
  codePoint: number;
  hex: string;
  line: number | null;
}

/** Scan export text against registered font coverage; skip characters the PDF Latin base covers. */
export function findMissingGlyphs(
  text: string,
  coverage: FontCoverage,
  options?: { markdownSource?: string; limit?: number },
): MissingGlyphHit[] {
  const limit = options?.limit ?? 8;
  const hits: MissingGlyphHit[] = [];
  const seen = new Set<number>();
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null) {
      continue;
    }
    if (isImplicitlyCovered(codePoint) || coverage.has(codePoint)) {
      continue;
    }
    if (seen.has(codePoint)) {
      continue;
    }
    seen.add(codePoint);
    hits.push({
      char,
      codePoint,
      hex: `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
      line: approximateMarkdownLine(options?.markdownSource, char),
    });
    if (hits.length >= limit) {
      break;
    }
  }
  return hits;
}

export function formatMissingGlyphError(hits: MissingGlyphHit[]): string {
  const details = hits
    .map((hit) => {
      const line = hit.line == null ? "" : `（约 Markdown 第 ${hit.line} 行）`;
      return `「${hit.char}」${hit.hex}${line}`;
    })
    .join("；");
  return `PDF 字体未覆盖以下字符，无法以矢量可搜索文字导出：${details}。请删除或替换这些字符后重试。`;
}

function isImplicitlyCovered(codePoint: number): boolean {
  // html2realpdf ships a built-in Noto Latin; keep common Latin/controls out of false positives.
  if (codePoint <= 0x007f) {
    return true;
  }
  if (codePoint >= 0x00a0 && codePoint <= 0x024f) {
    return true;
  }
  if (codePoint >= 0x2000 && codePoint <= 0x206f) {
    return true;
  }
  // Variation selectors / ZWJ used around emoji sequences.
  if (codePoint === 0x200d || codePoint === 0xfe0e || codePoint === 0xfe0f) {
    return true;
  }
  return false;
}

function approximateMarkdownLine(
  markdownSource: string | undefined,
  char: string,
): number | null {
  if (!markdownSource) {
    return null;
  }
  const index = markdownSource.indexOf(char);
  if (index < 0) {
    return null;
  }
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (markdownSource.charCodeAt(i) === 10) {
      line += 1;
    }
  }
  return line;
}
