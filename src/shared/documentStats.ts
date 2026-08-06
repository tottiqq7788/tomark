export interface DocumentStats {
  lines: number;
  chars: number;
  words: number;
}

/**
 * Count CJK ideographs as one word each; Latin/number tokens as space-separated words.
 */
export function countWords(text: string): number {
  if (!text) {
    return 0;
  }
  const cjkMatches = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g);
  const cjkCount = cjkMatches ? cjkMatches.reduce((n, s) => n + s.length, 0) : 0;
  const withoutCjk = text.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, " ");
  const latin = withoutCjk.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
  return cjkCount + (latin?.length ?? 0);
}

export function computeDocumentStats(source: string): DocumentStats {
  const lines = source.length === 0 ? 0 : source.split(/\r?\n/).length;
  const chars = Array.from(source).length;
  return {
    lines,
    chars,
    words: countWords(source),
  };
}

export function formatDocumentStats(stats: DocumentStats): string {
  return `行 ${stats.lines} · 字符 ${stats.chars} · 词 ${stats.words}`;
}
