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
});
