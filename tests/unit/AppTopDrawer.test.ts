import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import AppTopDrawer from "@/app/AppTopDrawer.vue";

async function flushOpenAnimation() {
  await flushPromises();
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await nextTick();
}

function overlay() {
  return document.querySelector('[data-testid="drawer-overlay"]');
}

function drawer() {
  return document.querySelector('[data-testid="drawer-drawer"]') as HTMLElement | null;
}

function closeButton() {
  return document.querySelector('[data-testid="drawer-close"]') as HTMLButtonElement | null;
}

function finishCloseTransition() {
  drawer()?.dispatchEvent(
    new TransitionEvent("transitionend", {
      propertyName: "transform",
      bubbles: true,
    }),
  );
}

describe("AppTopDrawer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens and closes with a single close emit", async () => {
    const wrapper = mount(AppTopDrawer, {
      props: { open: false, title: "测试" },
      slots: { default: "<p>content</p>" },
      attachTo: document.body,
    });

    await wrapper.setProps({ open: true });
    await flushOpenAnimation();
    expect(overlay()?.classList.contains("is-shown")).toBe(true);

    closeButton()?.click();
    finishCloseTransition();
    await flushPromises();
    expect(wrapper.emitted("close")?.length).toBe(1);
    wrapper.unmount();
  });

  it("closes on Escape", async () => {
    const wrapper = mount(AppTopDrawer, {
      props: { open: true, title: "测试" },
      attachTo: document.body,
    });
    await flushOpenAnimation();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    finishCloseTransition();
    await flushPromises();
    expect(wrapper.emitted("close")?.length).toBe(1);
    wrapper.unmount();
  });

  it("makes retained content inert and suppresses stale parent-driven closes", async () => {
    const wrapper = mount(AppTopDrawer, {
      props: { open: true, title: "测试" },
      slots: { default: '<button data-testid="inside">inside</button>' },
      attachTo: document.body,
    });
    await flushOpenAnimation();

    await wrapper.setProps({ open: false });
    await nextTick();
    expect(overlay()?.hasAttribute("inert")).toBe(true);
    finishCloseTransition();
    await flushPromises();
    expect(wrapper.emitted("close")).toBeUndefined();

    wrapper.unmount();
  });
});
