import { describe, expect, it, vi } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { buildEditableProjection } from "@/markdown/buildEditableProjection";
import { toggleInlineFormat } from "@/editor/markdownInlineFormatting";
import {
  mapNativeRangeToPmExact,
  resolveEditableFormatSelection,
} from "@/preview/editing/resolveEditableSelection";
import { editablePreviewSchema } from "@/preview/editing/schema";

function mapSourceToPm(
  projection: ReturnType<typeof buildEditableProjection>,
  offset: number,
): number {
  for (const seg of projection.sourceMap.segments) {
    if (seg.policy !== "editable") continue;
    for (let i = 0; i < seg.sourceOffsets.length; i++) {
      if (seg.sourceOffsets[i] === offset) return seg.pmFrom + i;
    }
  }
  throw new Error(`unmapped source offset ${offset}`);
}

function mountView(
  projection: ReturnType<typeof buildEditableProjection>,
  from: number,
  to: number,
) {
  const state = EditorState.create({
    schema: editablePreviewSchema,
    doc: projection.doc,
    selection: TextSelection.create(projection.doc, from, to),
  });
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  return view;
}

function mockNativeSelection(
  _view: EditorView,
  text: string,
  start: { node: Node; offset: number },
  end: { node: Node; offset: number },
) {
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  vi.spyOn(window, "getSelection").mockReturnValue({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => range,
  } as unknown as Selection);
  return range;
}

describe("resolveEditableFormatSelection (pure read)", () => {
  it("maps a matching PM selection for CJK 双向 without rewriting state", () => {
    const source =
      "轻量级跨平台 Markdown 编辑器。左侧编辑源码，右侧实时预览；标题可折叠，Cmd/Ctrl+点击可双向定位。\n";
    const projection = buildEditableProjection(source);
    const from = mapSourceToPm(projection, source.indexOf("双向"));
    const to = mapSourceToPm(projection, source.indexOf("双向") + 2);
    const view = mountView(projection, from, to);

    const beforeFrom = view.state.selection.from;
    const beforeTo = view.state.selection.to;
    const resolved = resolveEditableFormatSelection(view, projection, {
      revision: 7,
    });

    expect(view.state.selection.from).toBe(beforeFrom);
    expect(view.state.selection.to).toBe(beforeTo);
    expect(resolved).not.toBeNull();
    expect(source.slice(resolved!.from, resolved!.to)).toBe("双向");
    expect(resolved!.expectedText).toBe("双向");
    expect(resolved!.revision).toBe(7);
    expect(resolved!.pmFrom).toBe(from);
    expect(resolved!.pmTo).toBe(to);

    view.destroy();
    view.dom.parentElement?.remove();
  });

  it("maps ASCII ranges and preserves existing marks metadata", () => {
    const source = "Hello **world** today\n";
    const projection = buildEditableProjection(source);
    const from = mapSourceToPm(projection, source.indexOf("world"));
    const to = mapSourceToPm(projection, source.indexOf("world") + 5);
    const view = mountView(projection, from, to);

    const resolved = resolveEditableFormatSelection(view, projection, {
      revision: 1,
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.expectedText).toBe("world");
    expect(resolved!.active.bold).toBe(true);
    expect(resolved!.active.ranges.bold).toMatchObject({
      from: source.indexOf("**world**"),
      to: source.indexOf("**world**") + "**world**".length,
    });

    view.destroy();
    view.dom.parentElement?.remove();
  });

  it("supports reverse PM selections (head before anchor)", () => {
    const source = "alpha beta gamma\n";
    const projection = buildEditableProjection(source);
    const from = mapSourceToPm(projection, source.indexOf("beta"));
    const to = mapSourceToPm(projection, source.indexOf("beta") + 4);
    const state = EditorState.create({
      schema: editablePreviewSchema,
      doc: projection.doc,
      selection: TextSelection.create(projection.doc, to, from),
    });
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });

    expect(view.state.selection.from).toBe(from);
    expect(view.state.selection.to).toBe(to);
    const resolved = resolveEditableFormatSelection(view, projection);
    expect(resolved?.expectedText).toBe("beta");

    view.destroy();
    mount.remove();
  });

  it("refuses ambiguous native fallback when text search would be required", () => {
    const source = "展开 展开\n";
    const projection = buildEditableProjection(source);
    const firstFrom = mapSourceToPm(projection, source.indexOf("展开"));
    const firstTo = firstFrom + 2;
    // Skew PM one unit so it no longer matches native "展开".
    const view = mountView(projection, firstFrom + 1, firstTo + 1);
    expect(view.state.doc.textBetween(firstFrom + 1, firstTo + 1)).not.toBe(
      "展开",
    );

    mockNativeSelection(
      view,
      "展开",
      { node: view.dom, offset: 0 },
      { node: view.dom, offset: 0 },
    );
    // posAtDOM against the mocked range cannot validate — fail closed.
    const resolved = resolveEditableFormatSelection(view, projection, {
      allowNativeExactFallback: true,
    });
    expect(resolved).toBeNull();

    view.destroy();
    view.dom.parentElement?.remove();
  });

  it("accepts exact text-node offset mapping when native and PM disagree", () => {
    const source = "展开到正文\n";
    const projection = buildEditableProjection(source);
    const from = mapSourceToPm(projection, source.indexOf("展开"));
    const to = mapSourceToPm(projection, source.indexOf("展开") + 2);
    const skewed = mountView(projection, from + 1, to + 1);

    const walker = document.createTreeWalker(skewed.dom, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    let offset = -1;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const index = (node.textContent ?? "").indexOf("展开");
      if (index >= 0) {
        textNode = node;
        offset = index;
        break;
      }
    }
    expect(textNode).not.toBeNull();
    mockNativeSelection(
      skewed,
      "展开",
      { node: textNode!, offset },
      { node: textNode!, offset: offset + 2 },
    );

    const mapped = mapNativeRangeToPmExact(skewed);
    expect(mapped).toEqual({ from, to, text: "展开" });

    const resolved = resolveEditableFormatSelection(skewed, projection, {
      allowNativeExactFallback: true,
      revision: 3,
    });
    expect(resolved?.expectedText).toBe("展开");
    expect(resolved?.pmFrom).toBe(from);
    expect(resolved?.pmTo).toBe(to);
    // Pure read: skewed PM selection remains untouched.
    expect(skewed.state.selection.from).toBe(from + 1);
    expect(skewed.state.selection.to).toBe(to + 1);

    skewed.destroy();
    skewed.dom.parentElement?.remove();
  });

  it("keeps bold wrap on the highlighted glyphs", () => {
    const source =
      "1. 打开文档时沿第一条标题链展开到正文，其余标题折叠\n";
    const from = source.indexOf("展开");
    const change = toggleInlineFormat(source, from, from + 2, "bold");
    expect(change?.insert).toBe("**展开**");
  });
});
