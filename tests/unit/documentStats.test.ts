import { describe, expect, it } from "vitest";
import {
  computeDocumentStats,
  countWords,
  formatDocumentStats,
} from "@/shared/documentStats";

describe("documentStats", () => {
  it("counts empty document as one visual line", () => {
    expect(computeDocumentStats("")).toEqual({
      lines: 1,
      chars: 0,
      words: 0,
    });
  });

  it("counts lines, unicode chars and mixed words", () => {
    const source = "你好 world\n第二行";
    expect(computeDocumentStats(source)).toEqual({
      lines: 2,
      chars: 12,
      words: 6,
    });
    expect(countWords("tomark 编辑器")).toBe(4);
  });

  it("treats CRLF as a single line break", () => {
    expect(computeDocumentStats("a\r\nb")).toEqual({
      lines: 2,
      chars: 4,
      words: 2,
    });
  });

  it("formats status label", () => {
    expect(formatDocumentStats({ lines: 2, chars: 9, words: 4 })).toBe(
      "行 2 · 字符 9 · 词 4",
    );
  });
});
