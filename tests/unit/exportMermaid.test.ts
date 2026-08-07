import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildExportDocument } from "@/export/buildExportHtml";
import {
  __resetMermaidStateForTests,
  __setMermaidLoaderForTests,
} from "@/preview/renderMermaid";

describe("Mermaid export hydration", () => {
  let renderHostWidth = "";

  beforeEach(() => {
    renderHostWidth = "";
    __resetMermaidStateForTests();
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async () => {
          renderHostWidth =
            document.querySelector<HTMLElement>("[aria-hidden='true']")?.style
              .width ?? "";
          return {
            svg: '<svg data-testid="export-mermaid"></svg>',
            bindFunctions: undefined,
          };
        }),
      } as never,
    }));
  });

  afterEach(() => {
    document.body.innerHTML = "";
    __setMermaidLoaderForTests(null);
    __resetMermaidStateForTests();
  });

  it("renders diagrams in an export-width connected host", async () => {
    const document = await buildExportDocument({
      title: "diagram",
      markdownSource: "```mermaid\ngraph TD\nA-->B\n```",
      documentPath: null,
      embedImages: true,
    });

    expect(renderHostWidth).toBe("920px");
    expect(document.bodyHtml).toContain('data-testid="export-mermaid"');
    expect(document.bodyHtml).not.toContain("language-mermaid");
  });

  it("fails the export instead of silently reporting a broken diagram", async () => {
    __resetMermaidStateForTests();
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async () => {
          throw new Error("parse failed");
        }),
      } as never,
    }));

    await expect(
      buildExportDocument({
        title: "broken",
        markdownSource: "```mermaid\nBAD\n```",
        documentPath: null,
        embedImages: true,
      }),
    ).rejects.toThrow("Mermaid 图表渲染失败：parse failed");
  });
});
