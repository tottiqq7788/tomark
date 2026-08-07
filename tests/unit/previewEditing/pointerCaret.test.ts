import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "prosemirror-view";
import {
  buildEditableProjection,
  type EditableProjection,
  type ProjectionBlock,
} from "@/markdown/buildEditableProjection";
import { resolvePointerCaret } from "@/preview/editing/resolvePointerCaret";

interface TestRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function domRect(rect: TestRect): DOMRect {
  return {
    ...rect,
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    toJSON: () => ({}),
  } as DOMRect;
}

function domRectList(rects: readonly TestRect[]): DOMRectList {
  const values = rects.map(domRect);
  return Object.assign(values, {
    item: (index: number) => values[index] ?? null,
  }) as unknown as DOMRectList;
}

function setRect(element: Element, rect: TestRect): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => domRect(rect),
  });
}

function installGeometry(options: {
  root: HTMLElement;
  boxes: ReadonlyMap<Element, TestRect>;
  lines: ReadonlyMap<Element, readonly TestRect[]>;
  elementFromPoint: (x: number, y: number) => Element | null;
}): void {
  for (const [element, rect] of options.boxes) {
    setRect(element, rect);
  }

  const pointDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "elementFromPoint",
  );
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: options.elementFromPoint,
  });

  const rangeDescriptor = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getClientRects",
  );
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      const container =
        this.startContainer instanceof Element ? this.startContainer : null;
      return domRectList(container ? (options.lines.get(container) ?? []) : []);
    },
  });

  cleanups.push(() => {
    if (pointDescriptor) {
      Object.defineProperty(document, "elementFromPoint", pointDescriptor);
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    if (rangeDescriptor) {
      Object.defineProperty(
        Range.prototype,
        "getClientRects",
        rangeDescriptor,
      );
    } else {
      Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });
}

function sourceBlockElement(block: ProjectionBlock, text: string): HTMLElement {
  const element = document.createElement(
    block.nodeType === "heading" ? "h3" : "p",
  );
  element.dataset.tmSourceBlock = block.id;
  element.textContent = text;
  return element;
}

function stubView(options: {
  projection: EditableProjection;
  root: HTMLElement;
  positions: ReadonlyMap<Element, number>;
  coordsAtPos: (pos: number, side?: number) => TestRect;
  posAtCoords?: (coords: { left: number; top: number }) => number | null;
}): EditorView {
  return {
    dom: options.root,
    state: { doc: options.projection.doc },
    posAtDOM: vi.fn((node: Node) => {
      const pos = options.positions.get(node as Element);
      if (pos == null) {
        throw new Error("unknown DOM node");
      }
      return pos;
    }),
    coordsAtPos: vi.fn(options.coordsAtPos),
    posAtCoords: vi.fn((coords: { left: number; top: number }) => {
      const pos = options.posAtCoords?.(coords);
      return pos == null ? null : { pos, inside: -1 };
    }),
  } as unknown as EditorView;
}

describe("resolvePointerCaret", () => {
  it("maps trailing blank on each wrapped visual line to that line end", () => {
    const projection = buildEditableProjection("abcdefghij\n\nnext\n");
    const [first, second] = projection.sourceMap.blocks;
    const root = document.createElement("div");
    const firstEl = sourceBlockElement(first!, "abcdefghij");
    const secondEl = sourceBlockElement(second!, "next");
    root.append(firstEl, secondEl);
    document.body.appendChild(root);

    // WebKit may return full line-box rects whose adjacent edges touch.
    const firstLine = { top: 100, bottom: 125, left: 50, right: 100 };
    const secondLine = { top: 125, bottom: 150, left: 50, right: 100 };
    installGeometry({
      root,
      boxes: new Map([
        [root, { top: 80, bottom: 220, left: 40, right: 540 }],
        [firstEl, { top: 90, bottom: 158, left: 50, right: 500 }],
        [secondEl, { top: 170, bottom: 196, left: 50, right: 500 }],
      ]),
      lines: new Map([
        [firstEl, [firstLine, secondLine]],
        [
          secondEl,
          [{ top: 174, bottom: 192, left: 50, right: 90 }],
        ],
      ]),
      elementFromPoint: (_x, y) => (y < 160 ? firstEl : secondEl),
    });

    const boundary = first!.contentPmFrom + 5;
    const view = stubView({
      projection,
      root,
      positions: new Map([
        [firstEl, first!.contentPmFrom],
        [secondEl, second!.contentPmFrom],
      ]),
      coordsAtPos: (pos, side = 1) => {
        if (pos >= second!.contentPmFrom) {
          return { top: 174, bottom: 192, left: 50, right: 50 };
        }
        const firstVisualLine =
          pos < boundary || (pos === boundary && side < 0);
        return firstVisualLine
          ? { top: 100, bottom: 125, left: 80, right: 80 }
          : { top: 125, bottom: 150, left: 80, right: 80 };
      },
    });

    expect(resolvePointerCaret(view, 420, 112)).toEqual({
      pos: boundary,
      blank: true,
    });
    expect(resolvePointerCaret(view, 420, 138)).toEqual({
      pos: first!.contentPmTo,
      blank: true,
    });
    expect(boundary).not.toBe(first!.contentPmTo);
    expect(boundary).not.toBe(second!.contentPmFrom);
  });

  it("leaves glyph hits on the native ProseMirror path", () => {
    const projection = buildEditableProjection("hello world\n");
    const block = projection.sourceMap.blocks[0]!;
    const root = document.createElement("div");
    const paragraph = sourceBlockElement(block, "hello world");
    root.appendChild(paragraph);
    document.body.appendChild(root);

    installGeometry({
      root,
      boxes: new Map([
        [root, { top: 80, bottom: 180, left: 40, right: 540 }],
        [paragraph, { top: 90, bottom: 130, left: 50, right: 500 }],
      ]),
      lines: new Map([
        [paragraph, [{ top: 100, bottom: 118, left: 50, right: 150 }]],
      ]),
      elementFromPoint: () => paragraph,
    });
    const view = stubView({
      projection,
      root,
      positions: new Map([[paragraph, block.contentPmFrom]]),
      coordsAtPos: () => ({
        top: 100,
        bottom: 118,
        left: 80,
        right: 80,
      }),
    });

    expect(resolvePointerCaret(view, 90, 109)).toBeNull();
    expect(view.coordsAtPos).not.toHaveBeenCalled();
  });

  it("uses nearest-block semantics in vertical margins", () => {
    const projection = buildEditableProjection("above\n\nbelow\n");
    const [above, below] = projection.sourceMap.blocks;
    const root = document.createElement("div");
    const aboveEl = sourceBlockElement(above!, "above");
    const belowEl = sourceBlockElement(below!, "below");
    root.append(aboveEl, belowEl);
    document.body.appendChild(root);

    installGeometry({
      root,
      boxes: new Map([
        [root, { top: 80, bottom: 200, left: 40, right: 540 }],
        [aboveEl, { top: 100, bottom: 120, left: 50, right: 500 }],
        [belowEl, { top: 140, bottom: 160, left: 50, right: 500 }],
      ]),
      lines: new Map([
        [aboveEl, [{ top: 101, bottom: 119, left: 50, right: 100 }]],
        [belowEl, [{ top: 141, bottom: 159, left: 50, right: 100 }]],
      ]),
      elementFromPoint: () => root,
    });
    const view = stubView({
      projection,
      root,
      positions: new Map([
        [aboveEl, above!.contentPmFrom],
        [belowEl, below!.contentPmFrom],
      ]),
      coordsAtPos: (pos) =>
        pos <= above!.contentPmTo
          ? { top: 101, bottom: 119, left: 80, right: 80 }
          : { top: 141, bottom: 159, left: 80, right: 80 },
    });

    expect(resolvePointerCaret(view, 420, 125)?.pos).toBe(
      above!.contentPmTo,
    );
    expect(resolvePointerCaret(view, 420, 136)?.pos).toBe(
      below!.contentPmFrom,
    );
  });

  it("maps a task-list trailing blank to the exact paragraph end", () => {
    const projection = buildEditableProjection(
      "- [ ] 更多主题与字体设置（示例待办）\n\n### 引用\n",
    );
    const [task, heading] = projection.sourceMap.blocks;
    const root = document.createElement("div");
    const taskEl = sourceBlockElement(
      task!,
      "☐更多主题与字体设置（示例待办）",
    );
    const headingEl = sourceBlockElement(heading!, "引用");
    root.append(taskEl, headingEl);
    document.body.appendChild(root);

    installGeometry({
      root,
      boxes: new Map([
        [root, { top: 80, bottom: 190, left: 40, right: 540 }],
        [taskEl, { top: 90, bottom: 126, left: 50, right: 500 }],
        [headingEl, { top: 145, bottom: 170, left: 50, right: 500 }],
      ]),
      lines: new Map([
        [taskEl, [{ top: 100, bottom: 118, left: 50, right: 280 }]],
        [headingEl, [{ top: 149, bottom: 167, left: 50, right: 80 }]],
      ]),
      elementFromPoint: () => taskEl,
    });
    const view = stubView({
      projection,
      root,
      positions: new Map([
        [taskEl, task!.contentPmFrom],
        [headingEl, heading!.contentPmFrom],
      ]),
      coordsAtPos: (pos) =>
        pos <= task!.contentPmTo
          ? { top: 100, bottom: 118, left: 250, right: 250 }
          : { top: 149, bottom: 167, left: 50, right: 50 },
    });

    const resolved = resolvePointerCaret(view, 420, 109);
    expect(resolved?.pos).toBe(task!.contentPmTo);
    expect(resolved?.pos).not.toBe(heading!.contentPmFrom);
  });

  it("does not redirect blank clicks beside a read-only block", () => {
    const projection = buildEditableProjection("editable\n");
    const block = projection.sourceMap.blocks[0]!;
    const root = document.createElement("div");
    const readonly = document.createElement("div");
    readonly.className = "tm-readonly-block";
    readonly.dataset.tmReadonly = "unsupported";
    const paragraph = sourceBlockElement(block, "editable");
    root.append(readonly, paragraph);
    document.body.appendChild(root);

    installGeometry({
      root,
      boxes: new Map([
        [root, { top: 80, bottom: 200, left: 40, right: 540 }],
        [readonly, { top: 90, bottom: 126, left: 50, right: 220 }],
        [paragraph, { top: 145, bottom: 171, left: 50, right: 500 }],
      ]),
      lines: new Map([
        [paragraph, [{ top: 149, bottom: 167, left: 50, right: 120 }]],
      ]),
      elementFromPoint: () => root,
    });
    const view = stubView({
      projection,
      root,
      positions: new Map([[paragraph, block.contentPmFrom]]),
      coordsAtPos: () => ({
        top: 149,
        bottom: 167,
        left: 100,
        right: 100,
      }),
    });

    expect(resolvePointerCaret(view, 420, 109)).toBeNull();
    expect(view.coordsAtPos).not.toHaveBeenCalled();
  });
});
