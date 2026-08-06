import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewPane from "@/preview/PreviewPane.vue";
import { renderMarkdown } from "@/markdown/renderMarkdown";

describe("PreviewPane locate", () => {
  it("scrolls to anchored block for source line", async () => {
    const source = `# Alpha\n\nPara.\n\n## Beta\n\nTail.\n`;
    const { html, lineToAnchor } = renderMarkdown(source);
    const wrapper = mount(PreviewPane, {
      props: { html, lineToAnchor },
      attachTo: document.body,
    });
    await nextTick();

    const calls: Array<{ id: string | null }> = [];
    const realScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push({ id: (this as HTMLElement).getAttribute("data-anchor-id") });
    };

    const pane = wrapper.vm as unknown as {
      scrollToSourceLine: (line: number) => Promise<void>;
    };
    await pane.scrollToSourceLine(5);
    await nextTick();

    Element.prototype.scrollIntoView = realScroll;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].id).toBeTruthy();
    wrapper.unmount();
  });

  it("emits locate-source on Cmd/Ctrl+click of an anchored block", async () => {
    const source = `# Alpha\n\nPara.\n\n## Beta\n\nTail.\n`;
    const { html, lineToAnchor } = renderMarkdown(source);
    const wrapper = mount(PreviewPane, {
      props: { html, lineToAnchor },
      attachTo: document.body,
    });
    await nextTick();

    const anchored = wrapper.find("[data-source-line]");
    expect(anchored.exists()).toBe(true);
    await anchored.trigger("click", { metaKey: true });

    const events = wrapper.emitted("locate-source");
    expect(events).toBeTruthy();
    expect(events?.[0]?.[0]).toBe(Number(anchored.attributes("data-source-line")));
    wrapper.unmount();
  });

  it("does not emit locate-source without a modifier key", async () => {
    const source = `# Alpha\n\nPara.\n`;
    const { html, lineToAnchor } = renderMarkdown(source);
    const wrapper = mount(PreviewPane, {
      props: { html, lineToAnchor },
      attachTo: document.body,
    });
    await nextTick();

    await wrapper.find("[data-source-line]").trigger("click");
    expect(wrapper.emitted("locate-source")).toBeUndefined();
    wrapper.unmount();
  });
});
