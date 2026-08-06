import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import DirtyConfirmDialog from "@/app/DirtyConfirmDialog.vue";

describe("DirtyConfirmDialog", () => {
  it("exposes aria labels and focuses the save button when opened", async () => {
    const wrapper = mount(DirtyConfirmDialog, {
      props: {
        open: true,
        title: "未保存的更改",
        message: "要先保存吗？",
      },
      attachTo: document.body,
    });
    await flushPromises();

    const dialog = wrapper.get('[data-testid="dirty-dialog"]');
    expect(dialog.attributes("role")).toBe("dialog");
    expect(dialog.attributes("aria-labelledby")).toBe("dirty-dialog-title");
    expect(dialog.attributes("aria-describedby")).toBe("dirty-dialog-message");
    expect(wrapper.get('[data-testid="dirty-save"]').element).toBe(
      document.activeElement,
    );
    wrapper.unmount();
  });

  it("emits cancel on Escape", async () => {
    const wrapper = mount(DirtyConfirmDialog, {
      props: {
        open: true,
        title: "未保存的更改",
        message: "要先保存吗？",
      },
      attachTo: document.body,
    });
    await flushPromises();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(wrapper.emitted("cancel")).toBeTruthy();
    wrapper.unmount();
  });

  it("cycles focus with Tab", async () => {
    const wrapper = mount(DirtyConfirmDialog, {
      props: {
        open: true,
        title: "未保存的更改",
        message: "要先保存吗？",
      },
      attachTo: document.body,
    });
    await flushPromises();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(wrapper.get('[data-testid="dirty-discard"]').element).toBe(
      document.activeElement,
    );
    wrapper.unmount();
  });
});
