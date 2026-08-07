import { describe, expect, it } from "vitest";
import {
  buildHtmlAssetsBundle,
  defaultExportBaseName,
  wrapExportHtml,
} from "@/export/buildExportHtml";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import type { BuiltExportDocument } from "@/export/types";

describe("export html builders", () => {
  it("uses export mode without preview anchors", () => {
    const preview = renderMarkdown("# Title\n\nBody\n");
    const exported = renderMarkdown("# Title\n\nBody\n", { mode: "export" });
    expect(preview.html).toContain("data-anchor-id");
    expect(exported.html).not.toContain("data-anchor-id");
    expect(exported.html).not.toContain("data-source-line");
    expect(exported.anchors).toEqual([]);
  });

  it("wraps a full html document with charset and title", () => {
    const html = wrapExportHtml({
      title: "笔记 <test>",
      bodyHtml: "<p>你好</p>",
      css: "body{color:red}",
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<meta charset="utf-8"');
    expect(html).toContain("<title>笔记 &lt;test&gt;</title>");
    expect(html).toContain("<p>你好</p>");
    expect(html).toContain("body{color:red}");
  });

  it("derives default export base names", () => {
    expect(defaultExportBaseName("note.md")).toBe("note");
    expect(defaultExportBaseName("note.markdown")).toBe("note");
    expect(defaultExportBaseName("未命名.md")).toBe("未命名");
  });

  it("rewrites images into a sibling assets directory", () => {
    const document: BuiltExportDocument = {
      title: "demo",
      bodyHtml: '<p><img src="images/a.png" alt="a"></p>',
      fullHtml: "",
      css: "",
      warnings: [],
      images: [
        {
          originalSrc: "images/a.png",
          dataUrl: "data:image/png;base64,aaa",
          extension: "png",
          bytes: new Uint8Array([1, 2, 3]),
          assetName: "demo-01.png",
        },
      ],
    };
    const bundle = buildHtmlAssetsBundle(document, "demo");
    expect(bundle.assetsDirName).toBe("demo_files");
    expect(bundle.assets).toHaveLength(1);
    expect(bundle.htmlContent).toContain('src="demo_files/demo-01.png"');
    expect(bundle.htmlContent).not.toContain('src="images/a.png"');
  });
});
