import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import ExportProgressDialog from "@/app/ExportProgressDialog.vue";

describe("ExportProgressDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows an indeterminate bar while running and blocks Escape", async () => {
    const wrapper = mount(ExportProgressDialog, {
      props: {
        open: true,
        phase: "running",
        title: "正在导出",
        message: "正在准备文档…",
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(
      document.querySelector('[data-testid="export-progress-bar"]'),
    ).toBeTruthy();
    expect(
      document.querySelector('[data-testid="export-progress-close"]'),
    ).toBeNull();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await flushPromises();
    expect(wrapper.emitted("close")).toBeFalsy();
    wrapper.unmount();
  });

  it("focuses close and emits close after success", async () => {
    const wrapper = mount(ExportProgressDialog, {
      props: {
        open: true,
        phase: "success",
        title: "导出完成",
        message: "已导出：a.html",
        warnings: [{ src: "x.png", reason: "缺失" }],
      },
      attachTo: document.body,
    });
    await flushPromises();
    await nextTick();
    const close = document.querySelector(
      '[data-testid="export-progress-close"]',
    ) as HTMLButtonElement | null;
    expect(close).toBeTruthy();
    expect(document.activeElement).toBe(close);
    expect(
      document.querySelector('[data-testid="export-progress-warnings"]')
        ?.textContent,
    ).toContain("x.png");
    close?.click();
    expect(wrapper.emitted("close")?.length).toBe(1);
    wrapper.unmount();
  });
});
