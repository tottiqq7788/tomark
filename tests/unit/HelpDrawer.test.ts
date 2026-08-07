import { describe, expect, it, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import HelpDrawer from "@/app/HelpDrawer.vue";

async function flushOpenAnimation() {
  await flushPromises();
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await nextTick();
}

function overlay() {
  return document.querySelector('[data-testid="help-overlay"]');
}

function drawer() {
  return document.querySelector('[data-testid="help-drawer"]') as HTMLElement | null;
}

function closeButton() {
  return document.querySelector('[data-testid="help-close"]') as HTMLButtonElement | null;
}

function finishCloseTransition() {
  const el = drawer();
  el?.dispatchEvent(
    new TransitionEvent("transitionend", {
      propertyName: "transform",
      bubbles: true,
    }),
  );
}

describe("HelpDrawer", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens on prop change and closes via button with a single close emit", async () => {
    const wrapper = mount(HelpDrawer, {
      props: { open: false },
      attachTo: document.body,
    });

    await wrapper.setProps({ open: true });
    await flushOpenAnimation();

    expect(drawer()).toBeTruthy();
    expect(overlay()?.classList.contains("is-shown")).toBe(true);

    closeButton()?.click();
    finishCloseTransition();
    await flushPromises();

    expect(wrapper.emitted("close")?.length).toBe(1);
    expect(overlay()?.classList.contains("is-shown")).toBe(false);
    wrapper.unmount();
  });

  it("emits close on Escape only while open", async () => {
    const wrapper = mount(HelpDrawer, {
      props: { open: true },
      attachTo: document.body,
    });
    await flushOpenAnimation();

    expect(overlay()?.classList.contains("is-shown")).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    finishCloseTransition();
    await flushPromises();

    expect(wrapper.emitted("close")?.length).toBe(1);
    wrapper.unmount();
  });

  it("does not leave the drawer open after a fast open then close", async () => {
    const wrapper = mount(HelpDrawer, {
      props: { open: false },
      attachTo: document.body,
    });

    await wrapper.setProps({ open: true });
    await nextTick();
    await wrapper.setProps({ open: false });
    await flushOpenAnimation();
    await flushPromises();

    expect(overlay()?.classList.contains("is-shown")).toBeFalsy();
    expect(wrapper.emitted("close")).toBeFalsy();
    wrapper.unmount();
  });

  it("reopening during close does not stack Escape handlers", async () => {
    const wrapper = mount(HelpDrawer, {
      props: { open: true },
      attachTo: document.body,
    });
    await flushOpenAnimation();

    closeButton()?.click();
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushOpenAnimation();

    expect(overlay()?.classList.contains("is-shown")).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    finishCloseTransition();
    await flushPromises();

    expect(wrapper.emitted("close")?.length).toBe(1);
    wrapper.unmount();
  });

  it("focuses the close control when opened", async () => {
    const outside = document.createElement("button");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    outside.focus();

    const wrapper = mount(HelpDrawer, {
      props: { open: true },
      attachTo: document.body,
    });
    await flushOpenAnimation();
    await flushPromises();

    expect(document.activeElement).toBe(closeButton());
    wrapper.unmount();
    outside.remove();
  });

  it("emits request-default-app from the help action", async () => {
    const wrapper = mount(HelpDrawer, {
      props: { open: true },
      attachTo: document.body,
    });
    await flushOpenAnimation();
    const button = document.querySelector(
      '[data-testid="help-set-default-app"]',
    ) as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    button?.click();
    expect(wrapper.emitted("request-default-app")?.length).toBe(1);
    wrapper.unmount();
  });
});
