import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ExportSettingsPanel from "@/app/settings/ExportSettingsPanel.vue";
import { ExportCancelledError, ExportFailedError } from "@/export/types";

const runExport = vi.fn();
const selectExportTargetPath = vi.fn();

vi.mock("@/export/runExport", () => ({
  runExport: (...args: unknown[]) => runExport(...args),
  selectExportTargetPath: (...args: unknown[]) =>
    selectExportTargetPath(...args),
}));

describe("ExportSettingsPanel", () => {
  beforeEach(() => {
    runExport.mockReset();
    selectExportTargetPath.mockReset();
    selectExportTargetPath.mockResolvedValue("/tmp/a.pdf");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function clickExportAndFlush(
    wrapper: ReturnType<typeof mount>,
    testId: string,
  ) {
    await wrapper.get(`[data-testid="${testId}"]`).trigger("click");
    await flushPromises();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await flushPromises();
  }

  it("selects a path then exports pdf through the progress dialog", async () => {
    runExport.mockResolvedValue({
      path: "/tmp/a.pdf",
      fileName: "a.pdf",
      warnings: [],
    });
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
      attachTo: document.body,
    });
    await clickExportAndFlush(wrapper, "export-action-pdf");
    expect(selectExportTargetPath).toHaveBeenCalledWith("pdf", "a.md");
    expect(runExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "pdf",
        fileName: "a.md",
        targetPath: "/tmp/a.pdf",
      }),
    );
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toContain("已导出：a.pdf");
    expect(wrapper.emitted("busy")).toEqual([[true]]);
    document
      .querySelector('[data-testid="export-progress-close"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
    wrapper.unmount();
  });

  it("exports paged pdf via the dedicated action", async () => {
    selectExportTargetPath.mockResolvedValue("/tmp/a-分页.pdf");
    runExport.mockResolvedValue({
      path: "/tmp/a-分页.pdf",
      fileName: "a-分页.pdf",
      warnings: [],
      note: "共 2 页（A4 矢量分页）。",
    });
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
      attachTo: document.body,
    });
    await clickExportAndFlush(wrapper, "export-action-pdf-paged");
    expect(selectExportTargetPath).toHaveBeenCalledWith("pdf-paged", "a.md");
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toContain("a-分页.pdf");
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toContain("共 2 页");
    wrapper.unmount();
  });

  it("exports the document snapshot captured at click time", async () => {
    selectExportTargetPath.mockResolvedValue("/tmp/old.html");
    runExport.mockResolvedValue({
      path: "/tmp/old.html",
      fileName: "old.html",
      warnings: [],
    });
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# old",
        documentPath: "/notes/old.md",
        fileName: "old.md",
      },
      attachTo: document.body,
    });

    await wrapper
      .get('[data-testid="export-action-html-embedded"]')
      .trigger("click");
    await wrapper.setProps({
      markdownSource: "# new",
      documentPath: "/notes/new.md",
      fileName: "new.md",
    });
    await flushPromises();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await flushPromises();

    expect(runExport).toHaveBeenCalledWith(
      expect.objectContaining({
        markdownSource: "# old",
        documentPath: "/notes/old.md",
        fileName: "old.md",
        targetPath: "/tmp/old.html",
      }),
    );
    wrapper.unmount();
  });

  it("treats path cancel as a silent reset without a progress dialog", async () => {
    selectExportTargetPath.mockResolvedValue(null);
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
      attachTo: document.body,
    });
    await clickExportAndFlush(wrapper, "export-action-html-embedded");
    expect(runExport).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-testid="export-progress-dialog"]'),
    ).toBeNull();
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
    wrapper.unmount();
  });

  it("shows cancel results in the progress dialog", async () => {
    runExport.mockRejectedValue(new ExportCancelledError());
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
      attachTo: document.body,
    });
    await clickExportAndFlush(wrapper, "export-action-docx");
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toBe("已取消导出");
    wrapper.unmount();
  });

  it("treats cross-realm cancel errors by name", async () => {
    const foreign = new Error("已取消导出");
    foreign.name = "ExportCancelledError";
    runExport.mockRejectedValue(foreign);
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
      attachTo: document.body,
    });
    await clickExportAndFlush(wrapper, "export-action-docx");
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toBe("已取消导出");
    wrapper.unmount();
  });

  it("shows failure status until the dialog is closed", async () => {
    runExport.mockRejectedValue(new ExportFailedError("渲染失败"));
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
      attachTo: document.body,
    });
    await clickExportAndFlush(wrapper, "export-action-pdf");
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toBe("导出失败：渲染失败");
    expect(wrapper.emitted("busy")).toEqual([[true]]);
    document
      .querySelector('[data-testid="export-progress-close"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
    wrapper.unmount();
  });
});
