import { beforeEach, describe, expect, it, vi } from "vitest";
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
  });

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
    await wrapper.get('[data-testid="export-action-pdf"]').trigger("click");
    await flushPromises();
    expect(runExport).toHaveBeenCalledWith(
      expect.objectContaining({ format: "pdf", fileName: "a.md" }),
    );
    expect(wrapper.get('[data-testid="export-status"]').text()).toContain(
      "已导出：a.pdf",
    );
    expect(wrapper.emitted("status-message")?.[0]?.[0]).toContain("已导出");
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
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
    await wrapper.get('[data-testid="export-action-html-embedded"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="export-status"]').text()).toBe("已取消导出");
    expect(wrapper.emitted("status-message")?.[0]?.[0]).toBe("已取消导出");
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
    await wrapper.get('[data-testid="export-action-docx"]').trigger("click");
    await flushPromises();
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
    await wrapper.get('[data-testid="export-action-pdf"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="export-status"]').text()).toBe(
      "导出失败：渲染失败",
    );
    expect(wrapper.emitted("busy")).toEqual([[true], [false]]);
    wrapper.unmount();
  });
});
