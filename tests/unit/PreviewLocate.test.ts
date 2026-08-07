import { afterEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewPane from "@/preview/PreviewPane.vue";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import {
  __resetMermaidStateForTests,
  __setMermaidLoaderForTests,
} from "@/preview/renderMermaid";

function locateModifierInit(): { metaKey: boolean; ctrlKey: boolean } {
  const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  return isApple
    ? { metaKey: true, ctrlKey: false }
    : { metaKey: false, ctrlKey: true };
}

describe("PreviewPane locate", () => {
  afterEach(() => {
    __setMermaidLoaderForTests(null);
    __resetMermaidStateForTests();
  });

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
    await anchored.trigger("click", locateModifierInit());

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

  it("emits external links instead of navigating the editor webview", async () => {
    const source = `[site](https://example.com/docs)\n`;
    const { html, lineToAnchor } = renderMarkdown(source);
    const wrapper = mount(PreviewPane, {
      props: { html, lineToAnchor },
      attachTo: document.body,
    });
    await nextTick();

    await wrapper.get("a").trigger("click");

    expect(wrapper.emitted("open-link")).toEqual([
      ["https://example.com/docs"],
    ]);
    expect(wrapper.emitted("locate-source")).toBeUndefined();
    wrapper.unmount();
  });

  it("keeps same-document footnote links inside the preview", async () => {
    const source = `Ref[^n]\n\n[^n]: note\n`;
    const { html, lineToAnchor } = renderMarkdown(source);
    const wrapper = mount(PreviewPane, {
      props: { html, lineToAnchor },
      attachTo: document.body,
    });
    await nextTick();

    await wrapper.get('a[href^="#"]').trigger("click");

    expect(wrapper.emitted("open-link")).toBeUndefined();
    wrapper.unmount();
  });

  it("locates mermaid diagrams after async mount and Cmd/Ctrl+click", async () => {
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async (id: string) => ({
          svg: `<svg data-testid="m-${id}"><text>diagram</text></svg>`,
          bindFunctions: undefined,
        })),
      } as never,
    }));

    const source = `# Title\n\n\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`\n`;
    const { html, lineToAnchor } = renderMarkdown(source);
    const wrapper = mount(PreviewPane, {
      props: { html, lineToAnchor },
      attachTo: document.body,
    });

    await vi.waitFor(() => {
      expect(wrapper.find(".mermaid-diagram svg").exists()).toBe(true);
    });

    const diagram = wrapper.find(".mermaid-diagram");
    expect(diagram.attributes("data-source-line")).toBe("3");
    await diagram.trigger("click", locateModifierInit());
    expect(wrapper.emitted("locate-source")?.[0]?.[0]).toBe(3);

    const calls: Array<{ id: string | null }> = [];
    const realScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push({ id: (this as HTMLElement).getAttribute("data-anchor-id") });
    };
    const pane = wrapper.vm as unknown as {
      scrollToSourceLine: (line: number) => Promise<void>;
    };
    await pane.scrollToSourceLine(4);
    Element.prototype.scrollIntoView = realScroll;
    expect(calls[0]?.id).toBe(diagram.attributes("data-anchor-id"));

    wrapper.unmount();
  });
});
