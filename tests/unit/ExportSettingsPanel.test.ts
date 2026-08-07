import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ExportSettingsPanel from "@/app/settings/ExportSettingsPanel.vue";
import { ExportCancelledError, ExportFailedError } from "@/export/types";

const runExport = vi.fn();

vi.mock("@/export/runExport", () => ({
  runExport: (...args: unknown[]) => runExport(...args),
}));

describe("ExportSettingsPanel", () => {
  beforeEach(() => {
    runExport.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function clickExportAndFlush(
    wrapper: ReturnType<typeof mount>,
    testId: string,
  ) {
    await wrapper.get(`[data-testid="${testId}"]`).trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(60);
    await flushPromises();
  }

  it("exports pdf and shows success status", async () => {
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
    });
    const buttons = wrapper.findAll(".export-action");
    expect(buttons[0]?.attributes("data-testid")).toBe("export-action-pdf");
    expect(buttons[1]?.attributes("data-testid")).toBe("export-action-pdf-paged");
    await clickExportAndFlush(wrapper, "export-action-pdf");
    expect(runExport).toHaveBeenCalledWith(
      expect.objectContaining({ format: "pdf", fileName: "a.md" }),
    );
    expect(wrapper.get('[data-testid="export-status"]').text()).toContain(
      "已导出：a.pdf",
    );
    expect(wrapper.emitted("status-message")?.at(-1)?.[0]).toContain("已导出");
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
    wrapper.unmount();
  });

  it("exports paged pdf via the dedicated action", async () => {
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
    });
    await clickExportAndFlush(wrapper, "export-action-pdf-paged");
    expect(runExport).toHaveBeenCalledWith(
      expect.objectContaining({ format: "pdf-paged", fileName: "a.md" }),
    );
    expect(wrapper.get('[data-testid="export-status"]').text()).toContain("a-分页.pdf");
    expect(wrapper.get('[data-testid="export-status"]').text()).toContain("共 2 页");
    wrapper.unmount();
  });

  it("exports the document snapshot captured at click time", async () => {
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
    });

    await wrapper
      .get('[data-testid="export-action-html-embedded"]')
      .trigger("click");
    await wrapper.setProps({
      markdownSource: "# new",
      documentPath: "/notes/new.md",
      fileName: "new.md",
    });
    await vi.advanceTimersByTimeAsync(60);
    await flushPromises();

    expect(runExport).toHaveBeenCalledWith(
      expect.objectContaining({
        markdownSource: "# old",
        documentPath: "/notes/old.md",
        fileName: "old.md",
      }),
    );
    wrapper.unmount();
  });

  it("treats cancel as a non-error status and clears busy", async () => {
    runExport.mockRejectedValue(new ExportCancelledError());
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
    });
    await clickExportAndFlush(wrapper, "export-action-html-embedded");
    expect(wrapper.get('[data-testid="export-status"]').text()).toBe("已取消导出");
    expect(wrapper.emitted("status-message")?.at(-1)?.[0]).toBe("已取消导出");
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
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
    });
    await clickExportAndFlush(wrapper, "export-action-docx");
    expect(wrapper.get('[data-testid="export-status"]').text()).toBe("已取消导出");
    wrapper.unmount();
  });

  it("shows failure status and clears busy", async () => {
    runExport.mockRejectedValue(new ExportFailedError("渲染失败"));
    const wrapper = mount(ExportSettingsPanel, {
      props: {
        markdownSource: "# hi",
        documentPath: null,
        fileName: "a.md",
      },
    });
    await clickExportAndFlush(wrapper, "export-action-pdf");
    expect(wrapper.get('[data-testid="export-status"]').text()).toBe(
      "导出失败：渲染失败",
    );
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
    wrapper.unmount();
  });
});
