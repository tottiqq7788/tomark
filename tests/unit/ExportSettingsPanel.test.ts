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
    selectExportTargetPath.mockResolvedValue("/tmp/a.html");
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

  it("lists html, png and long-image pdf export actions", () => {
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
    });
    expect(wrapper.find('[data-testid="export-action-html-embedded"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="export-action-html-assets"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="export-action-png"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="export-action-pdf"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="export-action-pdf-paged"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-testid="export-action-docx"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("selects a path then exports html through the progress dialog", async () => {
    runExport.mockResolvedValue({
      path: "/tmp/a.html",
      fileName: "a.html",
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
    await clickExportAndFlush(wrapper, "export-action-html-embedded");
    expect(selectExportTargetPath).toHaveBeenCalledWith("html-embedded", "a.md");
    expect(runExport).toHaveBeenCalledWith(
      expect.objectContaining({
        format: "html-embedded",
        fileName: "a.md",
        targetPath: "/tmp/a.html",
      }),
    );
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toContain("已导出：a.html");
    expect(wrapper.emitted("busy")).toEqual([[true]]);
    document
      .querySelector('[data-testid="export-progress-close"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
    wrapper.unmount();
  });

  it("exports png via the dedicated action", async () => {
    selectExportTargetPath.mockResolvedValue("/tmp/a.png");
    runExport.mockResolvedValue({
      path: "/tmp/a.png",
      fileName: "a.png",
      warnings: [],
      note: "长图已按 1.00x 降采样，以避免超出画布上限。",
    });
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
      attachTo: document.body,
    });
    await clickExportAndFlush(wrapper, "export-action-png");
    expect(selectExportTargetPath).toHaveBeenCalledWith("png", "a.md");
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toContain("a.png");
    expect(
      document.querySelector('[data-testid="export-progress-message"]')
        ?.textContent,
    ).toContain("降采样");
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
    await clickExportAndFlush(wrapper, "export-action-html-assets");
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
    await clickExportAndFlush(wrapper, "export-action-png");
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
    await clickExportAndFlush(wrapper, "export-action-html-embedded");
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
