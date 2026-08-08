import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import SettingsDrawer from "@/app/SettingsDrawer.vue";
import {
  DEFAULT_SETTINGS_MENU_ID,
  SETTINGS_MENUS,
} from "@/app/settings/settingsMenus";

vi.mock("@/app/settings/ExportSettingsPanel.vue", () => ({
  default: {
    name: "ExportSettingsPanel",
    props: ["markdownSource", "documentPath", "fileName", "disabled"],
    emits: ["busy"],
    template: '<div data-testid="export-settings-panel">export-panel</div>',
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

  it("opens with the first menu item selected by default", async () => {
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
      document
        .querySelector(`[data-testid="settings-nav-${DEFAULT_SETTINGS_MENU_ID}"]`)
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(SETTINGS_MENUS[0]?.id).toBe(DEFAULT_SETTINGS_MENU_ID);
    expect(document.querySelector('[data-testid="export-settings-panel"]')).toBeTruthy();
    wrapper.unmount();
  });

  it("opens the help menu when initialMenu is help", async () => {
    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        initialMenu: "help",
        markdownSource: "# hi",
        documentPath: null,
        fileName: "未命名.md",
      },
      attachTo: document.body,
    });
    await flushOpenAnimation();

    expect(
      document
        .querySelector('[data-testid="settings-nav-help"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(document.querySelector('[data-testid="help-settings-panel"]')).toBeTruthy();
    wrapper.unmount();
  });

  it("switches the active menu when initialMenu changes while open", async () => {
    const wrapper = mount(SettingsDrawer, {
      props: {
        open: true,
        initialMenu: "export",
        markdownSource: "# hi",
        documentPath: null,
        fileName: "未命名.md",
      },
      attachTo: document.body,
    });
    await flushOpenAnimation();
    expect(
      document
        .querySelector('[data-testid="settings-nav-export"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");

    await wrapper.setProps({ initialMenu: "help" });
    await nextTick();
    expect(
      document
        .querySelector('[data-testid="settings-nav-help"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(document.querySelector('[data-testid="help-settings-panel"]')).toBeTruthy();
    wrapper.unmount();
  });

  it("exposes suspendFocusTrap from the top drawer", async () => {
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
    const resume = wrapper.vm.suspendFocusTrap();
    expect(typeof resume).toBe("function");
    resume();
    wrapper.unmount();
  });
});
