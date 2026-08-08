import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import HelpSettingsPanel from "@/app/settings/HelpSettingsPanel.vue";

describe("HelpSettingsPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("emits request-default-app from the help action", async () => {
    const wrapper = mount(HelpSettingsPanel, {
      props: { active: true },
      attachTo: document.body,
    });
    await wrapper.get('[data-testid="help-set-default-app"]').trigger("click");
    expect(wrapper.emitted("request-default-app")?.length).toBe(1);
    wrapper.unmount();
  });

  it("emits reidentify after expanding options", async () => {
    const wrapper = mount(HelpSettingsPanel, {
      props: { active: true, canReidentify: true },
      attachTo: document.body,
    });
    await wrapper.get('[data-testid="help-reidentify-toggle"]').trigger("click");
    await wrapper.get('[data-testid="help-reidentify-auto"]').trigger("click");
    expect(wrapper.emitted("reidentify")?.[0]?.[0]).toBe("auto");
    wrapper.unmount();
  });
});
