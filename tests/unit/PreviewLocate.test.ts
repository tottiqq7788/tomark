import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewPane from "@/preview/PreviewPane.vue";
import { buildEditableProjection } from "@/markdown/buildEditableProjection";
import { renderMarkdown } from "@/markdown/renderMarkdown";

function locateModifierInit(): { metaKey: boolean; ctrlKey: boolean } {
  const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  return isApple
    ? { metaKey: true, ctrlKey: false }
    : { metaKey: false, ctrlKey: true };
}

function mountEditablePreview(source: string) {
  const projection = buildEditableProjection(source);
  const { html, lineToAnchor } = renderMarkdown(source);
  return mount(PreviewPane, {
    props: {
      html,
      lineToAnchor,
      renderedSource: source,
      projection,
      renderMode: "editable" as const,
      editableSyncToken: 1,
      selectionRecovery: null,
      getRevision: () => 0,
      applySourceTransaction: () => ({
        ok: false as const,
        reason: "stale-revision" as const,
        revision: 0,
      }),
    },
    attachTo: document.body,
  });
}

function mountFallbackPreview(source: string) {
  const { html, lineToAnchor } = renderMarkdown(source);
  return mount(PreviewPane, {
    props: {
      html,
      lineToAnchor,
      renderedSource: source,
      projection: null,
      renderMode: "fallback" as const,
      editableSyncToken: 0,
      getRevision: () => 0,
      applySourceTransaction: () => ({
        ok: false as const,
        reason: "stale-revision" as const,
        revision: 0,
      }),
    },
    attachTo: document.body,
  });
}

function selectNeedle(wrapper: ReturnType<typeof mount>, needle: string) {
  const root = wrapper.get(".preview-content").element as HTMLElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    const index = text.indexOf(needle);
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    node = walker.nextNode();
  }
  throw new Error(`missing text ${needle}`);
}

describe("PreviewPane locate", () => {
  it("scrolls to anchored block for source line in editable mode", async () => {
    const source = `# Alpha\n\nPara.\n\n## Beta\n\nTail.\n`;
    const wrapper = mountEditablePreview(source);
    await flushPromises();
    await nextTick();

    const calls: unknown[] = [];
    const realScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push(this);
    };

    const pane = wrapper.vm as unknown as {
      scrollToSourceLine: (line: number) => Promise<void>;
    };
    await pane.scrollToSourceLine(5);
    await nextTick();

    Element.prototype.scrollIntoView = realScroll;
    expect(calls.length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it("opens links with Alt/Option+click in editable preview", async () => {
    const source = `[site](https://example.com/docs)\n`;
    const wrapper = mountEditablePreview(source);
    await flushPromises();
    await nextTick();

    const link = wrapper.get("a").element as HTMLAnchorElement;
    link.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        altKey: true,
      }),
    );
    await nextTick();

    expect(wrapper.emitted("open-link")).toEqual([
      ["https://example.com/docs"],
    ]);
    wrapper.unmount();
  });

  it("emits locate-source on Cmd/Ctrl+click of an anchored HTML fallback block", async () => {
    const source = `# Alpha\n\nPara.\n\n## Beta\n\nTail.\n`;
    const wrapper = mountFallbackPreview(source);
    await nextTick();

    const anchored = wrapper.find("[data-source-line]");
    expect(anchored.exists()).toBe(true);
    await anchored.trigger("click", locateModifierInit());

    const events = wrapper.emitted("locate-source");
    expect(events).toBeTruthy();
    expect(events?.[0]?.[0]).toBe(
      Number(anchored.attributes("data-source-line")),
    );
    wrapper.unmount();
  });

  it("does not emit locate-source without a modifier key on fallback", async () => {
    const source = `# Alpha\n\nPara.\n`;
    const wrapper = mountFallbackPreview(source);
    await nextTick();

    await wrapper.find("[data-source-line]").trigger("click");
    expect(wrapper.emitted("locate-source")).toBeUndefined();
    wrapper.unmount();
  });

  it("emits external links instead of navigating from HTML fallback", async () => {
    const source = `[site](https://example.com/docs)\n`;
    const wrapper = mountFallbackPreview(source);
    await nextTick();

    await wrapper.get("a").trigger("click");

    expect(wrapper.emitted("open-link")).toEqual([
      ["https://example.com/docs"],
    ]);
    expect(wrapper.emitted("locate-source")).toBeUndefined();
    wrapper.unmount();
  });

  it("keeps same-document footnote links inside the HTML fallback", async () => {
    const source = `Ref[^n]\n\n[^n]: note\n`;
    const wrapper = mountFallbackPreview(source);
    await nextTick();

    await wrapper.get('a[href^="#"]').trigger("click");

    expect(wrapper.emitted("open-link")).toBeUndefined();
    wrapper.unmount();
  });

  it("shows the format toolbar for an in-block text selection on fallback", async () => {
    const wrapper = mountFallbackPreview("Hello world today\n");
    await nextTick();
    selectNeedle(wrapper, "world");
    await nextTick();
    expect(
      wrapper.find('[data-testid="preview-format-toolbar"]').isVisible(),
    ).toBe(true);
    wrapper.unmount();
  });

  it("emits format-selection when bold is clicked on fallback", async () => {
    const wrapper = mountFallbackPreview("Hello world today\n");
    await nextTick();
    selectNeedle(wrapper, "world");
    await nextTick();
    await wrapper.get('[data-testid="format-bold"]').trigger("click");
    const events = wrapper.emitted("format-selection");
    expect(events?.[0]?.[0]).toMatchObject({
      action: { type: "toggle", format: "bold" },
      selection: expect.objectContaining({
        from: expect.any(Number),
        to: expect.any(Number),
      }),
    });
    wrapper.unmount();
  });

  it("mounts an editable ProseMirror host for normal projections", async () => {
    const wrapper = mountEditablePreview("Hello editable\n");
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-testid="preview-editable-host"]').exists()).toBe(
      true,
    );
    expect(wrapper.find(".ProseMirror").exists()).toBe(true);
    expect(buildEditableProjection("Hello editable\n").doc.childCount).toBe(1);
    wrapper.unmount();
  });
});
