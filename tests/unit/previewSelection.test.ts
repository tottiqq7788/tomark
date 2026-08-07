import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import {
  clampToolbarPosition,
  resolvePreviewSelection,
} from "@/preview/previewSelection";

function mountHtml(html: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "preview-content markdown-body";
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function selectTextIn(root: HTMLElement, needle: string): void {
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
      return;
    }
    node = walker.nextNode();
  }
  throw new Error(`text not found: ${needle}`);
}

describe("previewSelection", () => {
  it("maps an in-block selection to source offsets", () => {
    const source = "Hello **world** and more\n";
    const { html } = renderMarkdown(source);
    const root = mountHtml(html);
    selectTextIn(root, "world");

    const resolved = resolvePreviewSelection(root);
    expect(resolved).not.toBeNull();
    expect(source.slice(resolved!.from, resolved!.to)).toBe("world");
    expect(resolved!.active.bold).toBe(true);
    expect(resolved!.active.ranges.bold).toMatchObject({ from: 6, to: 15 });
    root.remove();
  });

  it("returns null for collapsed selections", () => {
    const { html } = renderMarkdown("Hello world\n");
    const root = mountHtml(html);
    const text = root.querySelector("[data-tm-from]")?.firstChild;
    expect(text).toBeTruthy();
    const range = document.createRange();
    range.setStart(text!, 1);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(resolvePreviewSelection(root)).toBeNull();
    root.remove();
  });

  it("hides formatting for cross-block selections", () => {
    const source = "First paragraph\n\nSecond paragraph\n";
    const { html } = renderMarkdown(source);
    const root = mountHtml(html);
    const spans = root.querySelectorAll("[data-tm-from]");
    expect(spans.length).toBeGreaterThanOrEqual(2);
    const a = spans[0].firstChild!;
    const b = spans[1].firstChild!;
    const range = document.createRange();
    range.setStart(a, 0);
    range.setEnd(b, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(resolvePreviewSelection(root)).toBeNull();
    root.remove();
  });

  it("ignores selections outside the preview container", () => {
    const outside = document.createElement("div");
    outside.textContent = "outside";
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const { html } = renderMarkdown("inside\n");
    const root = mountHtml(html);
    expect(resolvePreviewSelection(root)).toBeNull();
    outside.remove();
    root.remove();
  });

  it("refuses selections inside fenced code blocks", () => {
    const source = "```\ncode line\n```\n";
    const { html } = renderMarkdown(source);
    const root = mountHtml(html);
    const pre = root.querySelector("pre");
    expect(pre).toBeTruthy();
    // Even if a user selects text under pre, mapping must refuse.
    const text = pre?.querySelector("code")?.firstChild;
    if (text) {
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      expect(resolvePreviewSelection(root)).toBeNull();
    }
    root.remove();
  });

  it("clamps toolbar position into the viewport", () => {
    const pos = clampToolbarPosition(
      { top: 4, left: 10, bottom: 20, right: 100, width: 90, height: 16 },
      { width: 180, height: 40 },
      { width: 200, height: 100 },
      8,
    );
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + 180).toBeLessThanOrEqual(200);
  });
});
