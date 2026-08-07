import { describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { buildEditableProjection } from "@/markdown/buildEditableProjection";
import { resolveTrailingClickCaret } from "@/preview/editing/resolveTrailingClickCaret";
import { createPreviewEditSession } from "@/preview/editing/usePreviewEditSession";

describe("resolveTrailingClickCaret", () => {
  it("clamps a trailing-blank click to the end of the clicked block", () => {
    const source =
      "- 已打开文件：停止输入约 2 秒后自动保存\n- 未命名文档：用菜单落盘\n";
    const projection = buildEditableProjection(source);
    const first = projection.sourceMap.blocks.find(
      (block) => block.policy === "editable",
    )!;
    const second = projection.sourceMap.blocks.find(
      (block) =>
        block.policy === "editable" && block.id !== first.id,
    )!;
    expect(second.contentPmFrom).toBeGreaterThan(first.contentPmTo);

    const blockEl = document.createElement("p");
    blockEl.setAttribute("data-tm-source-block", first.id);
    Object.defineProperty(blockEl, "getBoundingClientRect", {
      value: () => ({
        top: 100,
        bottom: 126,
        left: 50,
        right: 500,
        width: 450,
        height: 26,
        x: 50,
        y: 100,
        toJSON() {
          return {};
        },
      }),
    });

    const view = {
      state: {
        selection: { empty: true, head: second.contentPmFrom },
      },
      coordsAtPos: vi.fn((pos: number) => {
        if (pos === first.contentPmTo) {
          return { left: 280, right: 280, top: 100, bottom: 126 };
        }
        return { left: 60, right: 60, top: 130, bottom: 156 };
      }),
    } as unknown as EditorView;

    const event = {
      button: 0,
      shiftKey: false,
      clientX: 420,
      clientY: 110,
      target: blockEl,
    } as unknown as MouseEvent;

    expect(resolveTrailingClickCaret(view, event, projection)).toBe(
      first.contentPmTo,
    );
  });

  it("does not override non-collapsed selections", () => {
    const projection = buildEditableProjection("- hello\n- world\n");
    const first = projection.sourceMap.blocks.find(
      (block) => block.policy === "editable",
    )!;
    const blockEl = document.createElement("p");
    blockEl.setAttribute("data-tm-source-block", first.id);
    Object.defineProperty(blockEl, "getBoundingClientRect", {
      value: () => ({
        top: 100,
        bottom: 126,
        left: 50,
        right: 500,
        width: 450,
        height: 26,
        x: 50,
        y: 100,
        toJSON() {
          return {};
        },
      }),
    });

    const view = {
      state: {
        selection: { empty: false, head: first.contentPmTo },
      },
      coordsAtPos: vi.fn(),
    } as unknown as EditorView;

    const event = {
      button: 0,
      shiftKey: false,
      clientX: 420,
      clientY: 110,
      target: blockEl,
    } as unknown as MouseEvent;

    expect(resolveTrailingClickCaret(view, event, projection)).toBeNull();
    expect(view.coordsAtPos).not.toHaveBeenCalled();
  });

  it("does not override Shift-clicks", () => {
    const projection = buildEditableProjection("- hello\n");
    const first = projection.sourceMap.blocks.find(
      (block) => block.policy === "editable",
    )!;
    const blockEl = document.createElement("p");
    blockEl.setAttribute("data-tm-source-block", first.id);

    const view = {
      state: { selection: { empty: true, head: first.contentPmFrom } },
      coordsAtPos: vi.fn(),
    } as unknown as EditorView;

    const event = {
      button: 0,
      shiftKey: true,
      clientX: 420,
      clientY: 110,
      target: blockEl,
    } as unknown as MouseEvent;

    expect(resolveTrailingClickCaret(view, event, projection)).toBeNull();
  });

  it("does not override clicks left of the content end", () => {
    const projection = buildEditableProjection("- hello\n");
    const first = projection.sourceMap.blocks.find(
      (block) => block.policy === "editable",
    )!;
    const blockEl = document.createElement("p");
    blockEl.setAttribute("data-tm-source-block", first.id);
    Object.defineProperty(blockEl, "getBoundingClientRect", {
      value: () => ({
        top: 100,
        bottom: 126,
        left: 50,
        right: 500,
        width: 450,
        height: 26,
        x: 50,
        y: 100,
        toJSON() {
          return {};
        },
      }),
    });

    const view = {
      state: {
        selection: { empty: true, head: first.contentPmFrom + 1 },
      },
      coordsAtPos: vi.fn(() => ({
        left: 280,
        right: 280,
        top: 100,
        bottom: 126,
      })),
    } as unknown as EditorView;

    const event = {
      button: 0,
      shiftKey: false,
      clientX: 200,
      clientY: 110,
      target: blockEl,
    } as unknown as MouseEvent;

    expect(resolveTrailingClickCaret(view, event, projection)).toBeNull();
  });
});

describe("preview edit session selection gestures", () => {
  it("keeps reverse selections intact through mouseup publish", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const source = "Hello world today\n";
    const projection = buildEditableProjection(source);
    let published: string | null = null;

    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 1,
      applySourceTransaction: () => ({
        ok: true,
        value: source,
        revision: 1,
      }),
      onSelectionChange: (selection) => {
        published = selection?.expectedText ?? null;
      },
    });

    const from = 1;
    const to = 6; // "Hello"
    session.view.dispatch(
      session.view.state.tr.setSelection(
        TextSelection.create(session.view.state.doc, to, from),
      ),
    );
    expect(session.view.state.selection.from).toBe(from);
    expect(session.view.state.selection.to).toBe(to);

    session.view.dom.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );

    await new Promise<void>((resolve) => {
      queueMicrotask(() => {
        requestAnimationFrame(() => resolve());
      });
    });

    expect(session.view.state.selection.from).toBe(from);
    expect(session.view.state.selection.to).toBe(to);
    expect(published).toBe("Hello");

    session.destroy();
    host.remove();
  });
});