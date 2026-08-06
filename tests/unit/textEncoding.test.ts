import { describe, expect, it } from "vitest";
import { utf8DocumentFormat } from "@/shared/types";
import { renderMarkdown } from "@/markdown/renderMarkdown";

describe("encoding compatibility helpers", () => {
  it("keeps utf-8 document format metadata complete", () => {
    expect(utf8DocumentFormat("crlf", true)).toEqual({
      lineEnding: "crlf",
      hasBom: true,
      encoding: "utf8",
      confidence: "certain",
      source: "default",
      allowDirectOverwrite: true,
    });
  });

  it("renders markdown that includes western punctuation", () => {
    const text = "# Title — Section\n\nHello — world.\n";
    const html = renderMarkdown(text).html;
    expect(html).toContain("Title");
    expect(html).toContain("—");
    expect(html.length).toBeGreaterThan(20);
  });
});
