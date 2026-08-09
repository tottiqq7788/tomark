import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewPane from "@/preview/PreviewPane.vue";
import { buildEditableProjection } from "@/markdown/buildEditableProjection";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import {
  __resetMermaidStateForTests,
  __setMermaidLoaderForTests,
} from "@/preview/renderMermaid";
import {
  __resetEditableMermaidPendingForTests,
  __setEditableMermaidRendererLoaderForTests,
} from "@/preview/editing/mermaidNodeView";
import { clearPreviewImageCache } from "@/preview/resolvePreviewImage";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
  afterEach(() => {
    clearPreviewImageCache();
    __setMermaidLoaderForTests(null);
    __resetMermaidStateForTests();
    __resetEditableMermaidPendingForTests();
    __setEditableMermaidRendererLoaderForTests(null);
  });

  it("scrolls to anchored block for source line in editable mode", async () => {
    const source = `# Alpha\n\nPara.\n\n## Beta\n\nTail.\n`;
    const wrapper = mountEditablePreview(source);
    await flushPromises();
    await nextTick();

    const calls: Element[] = [];
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

  it("renders thematic breaks as hr and keeps source locate mapping", async () => {
    const source = "before\n\n---\n\nafter\n";
    const wrapper = mountEditablePreview(source);
    await flushPromises();
    await nextTick();

    const hr = wrapper.find("hr");
    expect(hr.exists()).toBe(true);
    expect(wrapper.text()).not.toContain("分隔线");
    expect(hr.attributes("data-tm-readonly")).toContain("thematicBreak");
    expect(hr.attributes("contenteditable")).toBe("false");

    const block = buildEditableProjection(source).sourceMap.blocks.find(
      (candidate) => candidate.nodeType === "thematicBreak",
    )!;
    expect(block.sourceLine).toBe(3);

    const calls: Element[] = [];
    const realScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push(this);
    };
    const pane = wrapper.vm as unknown as {
      scrollToSourceLine: (line: number) => Promise<void>;
    };
    await pane.scrollToSourceLine(3);
    Element.prototype.scrollIntoView = realScroll;
    expect(calls[0]).toBe(hr.element);

    wrapper.unmount();
  });

  it("locates mermaid diagrams after async mount and Cmd/Ctrl+click on fallback", async () => {
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
    const wrapper = mountFallbackPreview(source);

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

  it("keeps locate anchors on mermaid error blocks in fallback", async () => {
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async () => {
          throw new Error("bad diagram");
        }),
      } as never,
    }));

    const source = `# Title\n\n\`\`\`mermaid\ngraph TD\n  A ->\n\`\`\`\n`;
    const wrapper = mountFallbackPreview(source);

    await vi.waitFor(() => {
      expect(wrapper.find(".mermaid-error").exists()).toBe(true);
    });

    const err = wrapper.find(".mermaid-error");
    expect(err.attributes("data-source-line")).toBe("3");
    await err.trigger("click", locateModifierInit());
    expect(wrapper.emitted("locate-source")?.[0]?.[0]).toBe(3);

    wrapper.unmount();
  });

  it("mounts mermaid diagrams via editable readonly NodeView", async () => {
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async (id: string) => ({
          svg: `<svg data-testid="m-edit-${id}"><text>diagram</text></svg>`,
          bindFunctions: undefined,
        })),
      } as never,
    }));

    const source = `# Title\n\n\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`\n`;
    const projection = buildEditableProjection(source);
    const mermaidNode = [...Array(projection.doc.childCount)].map((_, i) =>
      projection.doc.child(i),
    ).find((child) => child.type.name === "readonly_block" && child.attrs.kind === "mermaid");
    expect(mermaidNode).toBeTruthy();
    expect(String(mermaidNode?.attrs.code)).toContain("graph TD");

    const wrapper = mountEditablePreview(source);
    await flushPromises();

    await vi.waitFor(() => {
      expect(wrapper.find(".tm-readonly-mermaid .mermaid-diagram svg").exists()).toBe(
        true,
      );
    });

    const host = wrapper.find(".tm-readonly-mermaid");
    expect(host.attributes("contenteditable")).toBe("false");
    expect(host.attributes("data-tm-readonly")).toContain("read-only");

    const calls: unknown[] = [];
    const realScroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push(this);
    };
    const pane = wrapper.vm as unknown as {
      scrollToSourceLine: (line: number) => Promise<void>;
    };
    await pane.scrollToSourceLine(4);
    Element.prototype.scrollIntoView = realScroll;
    expect(calls[0]).toBe(host.element);

    wrapper.unmount();
  });

  it("shows an error block when the editable renderer chunk fails to load", async () => {
    __setEditableMermaidRendererLoaderForTests(async () => {
      throw new Error("renderer chunk missing");
    });

    const source = `\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`\n`;
    const wrapper = mountEditablePreview(source);

    await vi.waitFor(() => {
      expect(wrapper.find(".tm-readonly-mermaid .mermaid-error").exists()).toBe(
        true,
      );
    });

    expect(wrapper.get(".mermaid-error-detail").text()).toContain(
      "无法加载 Mermaid：renderer chunk missing",
    );
    expect(wrapper.get(".mermaid-error-source").text()).toContain("graph TD");
    wrapper.unmount();
  });

  it("discards an in-flight editable render when the fence becomes ordinary code", async () => {
    let releaseRender = () => {};
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const render = vi.fn(async () => {
      await renderGate;
      return {
        svg: `<svg data-testid="stale-mermaid"></svg>`,
        bindFunctions: undefined,
      };
    });
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render,
      } as never,
    }));

    const source = `\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`\n`;
    const wrapper = mountEditablePreview(source);
    await vi.waitFor(() => {
      expect(render).toHaveBeenCalledOnce();
    });

    const nextSource = `\`\`\`js\nconsole.log("plain code")\n\`\`\`\n`;
    const projection = buildEditableProjection(nextSource);
    const { html, lineToAnchor } = renderMarkdown(nextSource);
    await wrapper.setProps({
      html,
      lineToAnchor,
      renderedSource: nextSource,
      projection,
      editableSyncToken: 2,
    });
    await nextTick();

    expect(wrapper.find(".tm-readonly-code").exists()).toBe(true);
    releaseRender();
    await flushPromises();

    expect(wrapper.find('[data-testid="stale-mermaid"]').exists()).toBe(false);
    expect(wrapper.get(".tm-readonly-code").text()).toContain(
      'console.log("plain code")',
    );
    wrapper.unmount();
  });

  it("shows Mermaid icon toolbar on plain click and hides on Esc / rebuild", async () => {
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async () => ({
          svg: `<svg data-testid="toolbar-mermaid"><text>diagram</text></svg>`,
          bindFunctions: undefined,
        })),
      } as never,
    }));
    __setEditableMermaidRendererLoaderForTests(async () => ({
      renderMermaidInto: (
        await import("@/preview/renderMermaid")
      ).renderMermaidInto,
    }));

    const source = `# Title\n\nHello world.\n\n\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`\n`;
    const wrapper = mountEditablePreview(source);
    await vi.waitFor(() => {
      expect(
        wrapper.find(".tm-readonly-mermaid .mermaid-diagram svg").exists(),
      ).toBe(true);
    });

    const diagram = wrapper.find(
      ".tm-readonly-mermaid .mermaid-diagram[data-mermaid='1']",
    );
    const diagramEl = diagram.element as HTMLElement;
    diagramEl.getBoundingClientRect = () =>
      ({
        x: 40,
        y: 80,
        top: 80,
        left: 40,
        bottom: 200,
        right: 240,
        width: 200,
        height: 120,
        toJSON: () => ({}),
      }) as DOMRect;
    const svg = diagram.find("svg");
    await svg.trigger("click");
    await nextTick();

    const toolbar = wrapper.find('[data-testid="preview-mermaid-toolbar"]');
    expect(toolbar.isVisible()).toBe(true);
    expect(wrapper.find('[data-testid="mermaid-fullscreen"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="mermaid-copy-source"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="mermaid-copy-image"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="mermaid-export-svg"]').text()).toBe(
      "SVG",
    );
    expect(wrapper.find('[data-testid="mermaid-export-png"]').text()).toBe(
      "PNG",
    );
    expect(
      wrapper.find('[data-testid="mermaid-locate-source"]').exists(),
    ).toBe(false);

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await wrapper.find('[data-testid="mermaid-copy-source"]').trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining("graph TD"),
    );
    expect(wrapper.emitted("status")?.at(-1)?.[0]).toBe("已复制 Mermaid 源码");

    const pngMod = await import("@/export/exportMermaidDiagramPng");
    const copyImage = vi
      .spyOn(pngMod, "copyMermaidDiagramPngToClipboard")
      .mockResolvedValue({ width: 20, height: 10 });
    await wrapper.find('[data-testid="mermaid-copy-image"]').trigger("click");
    await flushPromises();
    expect(copyImage).toHaveBeenCalledWith(
      expect.stringContaining("graph TD"),
    );
    expect(wrapper.emitted("status")?.at(-1)?.[0]).toBe("已复制 Mermaid 图片");
    copyImage.mockRestore();

    // Outside click dismisses the Mermaid toolbar.
    await wrapper.get(".preview-pane").trigger("click");
    await nextTick();
    expect(
      wrapper.find('[data-testid="preview-mermaid-toolbar"]').isVisible(),
    ).toBe(false);

    await svg.trigger("click");
    await nextTick();
    expect(
      wrapper.find('[data-testid="preview-mermaid-toolbar"]').isVisible(),
    ).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(
      wrapper.find('[data-testid="preview-mermaid-toolbar"]').isVisible(),
    ).toBe(false);

    await svg.trigger("click");
    await nextTick();
    const nextSource = `# rebuilt\n`;
    const projection = buildEditableProjection(nextSource);
    const { html, lineToAnchor } = renderMarkdown(nextSource);
    await wrapper.setProps({
      html,
      lineToAnchor,
      renderedSource: nextSource,
      projection,
      editableSyncToken: 3,
    });
    await nextTick();
    expect(
      wrapper.find('[data-testid="preview-mermaid-toolbar"]').isVisible(),
    ).toBe(false);

    wrapper.unmount();
  });

  it("does not show Mermaid toolbar for Cmd/Ctrl locate clicks", async () => {
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async () => ({
          svg: `<svg data-testid="locate-only"><text>diagram</text></svg>`,
          bindFunctions: undefined,
        })),
      } as never,
    }));

    const source = `# Title\n\n\`\`\`mermaid\ngraph TD\n  A-->B\n\`\`\`\n`;
    const wrapper = mountFallbackPreview(source);
    await vi.waitFor(() => {
      expect(wrapper.find(".mermaid-diagram svg").exists()).toBe(true);
    });

    await wrapper
      .find(".mermaid-diagram svg")
      .trigger("click", locateModifierInit());
    await nextTick();
    expect(wrapper.emitted("locate-source")?.[0]?.[0]).toBe(3);
    expect(
      wrapper.find('[data-testid="preview-mermaid-toolbar"]').isVisible(),
    ).toBe(false);
    wrapper.unmount();
  });

  it("does not show Mermaid toolbar for error blocks", async () => {
    __setMermaidLoaderForTests(async () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn(async () => {
          throw new Error("bad diagram");
        }),
      } as never,
    }));

    const source = `# Title\n\n\`\`\`mermaid\ngraph TD\n  A ->\n\`\`\`\n`;
    const wrapper = mountFallbackPreview(source);
    await vi.waitFor(() => {
      expect(wrapper.find(".mermaid-error").exists()).toBe(true);
    });

    await wrapper.find(".mermaid-error").trigger("click");
    await nextTick();
    expect(
      wrapper.find('[data-testid="preview-mermaid-toolbar"]').isVisible(),
    ).toBe(false);
    wrapper.unmount();
  });

  it("shows image toolbar on plain click of a resolved data URL image", async () => {
    const source = `# Title\n\n![tiny](${TINY_PNG})\n`;
    const wrapper = mountEditablePreview(source);
    await vi.waitFor(() => {
      expect(
        wrapper
          .find(".preview-image[data-preview-image='1'] img")
          .exists(),
      ).toBe(true);
    });

    const imageWrap = wrapper.find(
      ".preview-image[data-preview-image='1']",
    );
    const el = imageWrap.element as HTMLElement;
    el.getBoundingClientRect = () =>
      ({
        x: 40,
        y: 80,
        top: 80,
        left: 40,
        bottom: 140,
        right: 140,
        width: 100,
        height: 60,
        toJSON: () => ({}),
      }) as DOMRect;
    await imageWrap.find("img").trigger("click");
    await nextTick();

    expect(
      wrapper.find('[data-testid="preview-image-toolbar"]').isVisible(),
    ).toBe(true);
    expect(wrapper.find('[data-testid="image-fullscreen"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="image-copy-image"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-testid="image-export-png"]').text()).toBe(
      "PNG",
    );
    expect(
      wrapper.find('[data-testid="preview-mermaid-toolbar"]').isVisible(),
    ).toBe(false);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(
      wrapper.find('[data-testid="preview-image-toolbar"]').isVisible(),
    ).toBe(false);
    wrapper.unmount();
  });
});
