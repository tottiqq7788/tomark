import { describe, expect, it, vi } from "vitest";
import { buildEditableProjection } from "@/markdown/buildEditableProjection";
import { resolveTrailingClickCaret } from "@/preview/editing/resolveTrailingClickCaret";
import type { EditorView } from "prosemirror-view";

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
      posAtCoords: vi.fn(() => ({
        pos: second.contentPmFrom,
        inside: second.contentPmFrom,
      })),
      coordsAtPos: vi.fn((pos: number) => {
        if (pos === first.contentPmFrom) {
          return { left: 60, right: 60, top: 100, bottom: 126 };
        }
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

  it("does not override clicks that already resolve inside the block", () => {
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

    const inside = first.contentPmFrom + 2;
    const view = {
      posAtCoords: vi.fn(() => ({ pos: inside, inside })),
      coordsAtPos: vi.fn(),
    } as unknown as EditorView;

    const event = {
      button: 0,
      shiftKey: false,
      clientX: 120,
      clientY: 110,
      target: blockEl,
    } as unknown as MouseEvent;

    expect(resolveTrailingClickCaret(view, event, projection)).toBeNull();
    expect(view.coordsAtPos).not.toHaveBeenCalled();
  });
});
