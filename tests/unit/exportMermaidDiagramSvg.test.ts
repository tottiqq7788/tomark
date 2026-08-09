import { beforeEach, describe, expect, it, vi } from "vitest";

const renderMermaidSvg = vi.fn();
const saveTextWithDialog = vi.fn();
const writeExportText = vi.fn();

vi.mock("@/preview/renderMermaid", () => ({
  renderMermaidSvg: (...args: unknown[]) => renderMermaidSvg(...args),
}));

vi.mock("@/native/exportFileService", () => ({
  saveTextWithDialog: (...args: unknown[]) => saveTextWithDialog(...args),
  writeExportText: (...args: unknown[]) => writeExportText(...args),
}));

import {
  exportMermaidDiagramSvg,
  suggestMermaidSvgName,
} from "@/export/exportMermaidDiagramSvg";

describe("exportMermaidDiagramSvg", () => {
  beforeEach(() => {
    renderMermaidSvg.mockReset();
    saveTextWithDialog.mockReset();
    writeExportText.mockReset();
    renderMermaidSvg.mockResolvedValue(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>`,
    );
    writeExportText.mockResolvedValue(undefined);
    saveTextWithDialog.mockResolvedValue({
      path: "/tmp/demo-mermaid-1.svg",
      fileName: "demo-mermaid-1.svg",
    });
  });

  it("suggests document-scoped SVG names", () => {
    expect(suggestMermaidSvgName("notes.md", 3)).toBe("notes-mermaid-3.svg");
  });

  it("writes through targetPath without opening a dialog", async () => {
    const result = await exportMermaidDiagramSvg({
      source: "graph TD\nA-->B",
      fileName: "demo.md",
      diagramIndex: 1,
      targetPath: "/tmp/forced.svg",
    });
    expect(writeExportText).toHaveBeenCalledWith(
      "/tmp/forced.svg",
      expect.stringContaining("<svg"),
    );
    expect(saveTextWithDialog).not.toHaveBeenCalled();
    expect(result.path).toBe("/tmp/forced.svg");
  });

  it("maps cancel to ExportCancelledError", async () => {
    const { ExportCancelledError } = await import("@/export/types");
    saveTextWithDialog.mockRejectedValue(new ExportCancelledError());
    await expect(
      exportMermaidDiagramSvg({
        source: "graph TD\nA-->B",
        fileName: "demo.md",
      }),
    ).rejects.toMatchObject({ name: "ExportCancelledError" });
  });
});
