import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import SettingsDrawer from "@/app/SettingsDrawer.vue";

vi.mock("@/app/settings/ExportSettingsPanel.vue", () => ({
  default: {
    name: "ExportSettingsPanel",
    props: ["markdownSource", "documentPath", "fileName", "disabled"],
    emits: ["busy", "status-message"],
    template:
      '<div data-testid="export-settings-panel">export-panel</div>',
  },
}));

async function flushOpenAnimation() {
  await flushPromises();
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await nextTick();
}

describe("SettingsDrawer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens with export menu selected by default", async () => {
    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        markdownSource: "# hi",
        documentPath: null,
        fileName: "未命名.md",
      },
      attachTo: document.body,
    });
    await flushOpenAnimation();

    expect(document.querySelector('[data-testid="settings-drawer"]')).toBeTruthy();
    expect(
      document.querySelector('[data-testid="settings-nav-export"]')?.getAttribute(
        "aria-current",
      ),
    ).toBe("page");
    expect(document.querySelector('[data-testid="export-settings-panel"]')).toBeTruthy();
    wrapper.unmount();
  });
});
