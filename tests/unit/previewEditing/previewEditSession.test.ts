import { afterEach, describe, expect, it, vi } from "vitest";
import { TextSelection } from "prosemirror-state";
import {
  buildEditableProjection,
  type ProjectionBlock,
} from "@/markdown/buildEditableProjection";
import {
  createPreviewEditSession,
  type PreviewEditSession,
} from "@/preview/editing/usePreviewEditSession";

describe("createPreviewEditSession", () => {
  let host: HTMLElement | null = null;
  let geometryCleanup: (() => void) | null = null;

  afterEach(() => {
    geometryCleanup?.();
    geometryCleanup = null;
    vi.restoreAllMocks();
    host?.remove();
    host = null;
  });

  function installSingleLinePointerGeometry(
    session: PreviewEditSession,
    block: ProjectionBlock,
  ): HTMLElement {
    const root = session.view.dom;
    const paragraph = root.querySelector<HTMLElement>(
      `[data-tm-source-block="${block.id}"]`,
    )!;
    const line = {
      top: 100,
      bottom: 118,
      left: 50,
      right: 180,
      x: 50,
      y: 100,
      width: 130,
      height: 18,
      toJSON: () => ({}),
    } as DOMRect;
    const rootRect = {
      top: 80,
      bottom: 220,
      left: 40,
      right: 540,
      x: 40,
      y: 80,
      width: 500,
      height: 140,
      toJSON: () => ({}),
    } as DOMRect;
    const blockRect = {
      top: 90,
      bottom: 128,
      left: 50,
      right: 500,
      x: 50,
      y: 90,
      width: 450,
      height: 38,
      toJSON: () => ({}),
    } as DOMRect;
    Object.defineProperty(root, "getBoundingClientRect", {
      configurable: true,
      value: () => rootRect,
    });
    Object.defineProperty(paragraph, "getBoundingClientRect", {
      configurable: true,
      value: () => blockRect,
    });

    const pointDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "elementFromPoint",
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => paragraph,
    });
    const rangeDescriptor = Object.getOwnPropertyDescriptor(
      Range.prototype,
      "getClientRects",
    );
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () =>
        Object.assign([line], {
          item: (index: number) => (index === 0 ? line : null),
        }) as unknown as DOMRectList,
    });

    vi.spyOn(session.view, "coordsAtPos").mockImplementation((pos) => {
      const ratio =
        (pos - block.contentPmFrom) /
        Math.max(1, block.contentPmTo - block.contentPmFrom);
      const left = 50 + Math.max(0, Math.min(1, ratio)) * 130;
      return {
        top: 100,
        bottom: 118,
        left,
        right: left,
      };
    });
    vi.spyOn(session.view, "posAtCoords").mockImplementation(({ left }) => ({
      pos: left < 200 ? block.contentPmFrom + 5 : block.contentPmTo,
      inside: block.pmFrom,
    }));

    geometryCleanup = () => {
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
    };
    return paragraph;
  }

  it("ignores document mutations because the preview is non-editable", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world\n";
    const projection = buildEditableProjection(source);
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
    });

    expect(session.view.editable).toBe(false);
    const before = session.view.state.doc.textContent;
    const segment = projection.sourceMap.segments[0]!;
    const pos = segment.pmFrom + "Hello ".length;
    session.view.dispatch(session.view.state.tr.insertText("X", pos, pos));
    expect(session.view.state.doc.textContent).toBe(before);
    session.destroy();
  });

  it("maps a non-collapsed selection to source offsets", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world today\n";
    const projection = buildEditableProjection(source);
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
    });

    const segment = projection.sourceMap.segments[0]!;
    const from = segment.pmFrom + segment.text.indexOf("world");
    const to = from + 5;
    session.view.dispatch(
      session.view.state.tr.setSelection(
        TextSelection.create(session.view.state.doc, from, to),
      ),
    );
    const selection = session.getFormatSelection();
    expect(selection).toMatchObject({
      from: source.indexOf("world"),
      to: source.indexOf("world") + 5,
    });
    session.destroy();
  });

  it("does not paint a block focus outline decoration", () => {
    host = document.createElement("div");
    document.body.append(host);
    const projection = buildEditableProjection("Hello world\n");
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
    });
    session.focus();
    expect(host.querySelector(".tm-preview-focus")).toBeNull();
    expect(
      getComputedStyle(session.view.dom).outlineStyle === "none" ||
        getComputedStyle(session.view.dom).outlineWidth === "0px",
    ).toBe(true);
    session.destroy();
  });

  it("recovers selection exactly at wrapper boundaries without fuzzy snap", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello **world** today\n";
    const projection = buildEditableProjection(source);
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
    });

    const worldIndex = source.indexOf("world");
    session.rebuild(buildEditableProjection(source), {
      selection: { anchor: worldIndex, head: worldIndex },
    });
    const mapped = session.view.state.selection.head;
    const segment = projection.sourceMap.segments.find(
      (item) => item.text === "world",
    )!;
    expect(mapped).toBe(segment.pmFrom);

    const innerStarOffset = source.indexOf("**") + 1;
    const block = projection.sourceMap.blocks.find(
      (item) => item.policy === "editable",
    )!;
    session.rebuild(buildEditableProjection(source), {
      selection: { anchor: innerStarOffset, head: innerStarOffset },
    });
    expect(session.view.state.selection.head).toBe(block.contentPmFrom);
    session.destroy();
  });

  it("keeps a jittered trailing-blank click at the resolved line end", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const source = "Hello world today\n";
    const projection = buildEditableProjection(source);
    const block = projection.sourceMap.blocks[0]!;
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
    });
    const paragraph = installSingleLinePointerGeometry(session, block);

    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      detail: 1,
      clientX: 420,
      clientY: 109,
    });
    paragraph.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(session.view.state.selection.head).toBe(block.contentPmTo);

    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        buttons: 1,
        clientX: 426,
        clientY: 115,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 426,
        clientY: 115,
      }),
    );

    expect(session.view.state.selection.empty).toBe(true);
    expect(session.view.state.selection.head).toBe(block.contentPmTo);
    session.destroy();
  });

  it("extends a selection when dragging from trailing blank into text", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const source = "Hello world today\n";
    const projection = buildEditableProjection(source);
    const block = projection.sourceMap.blocks[0]!;
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
    });
    const paragraph = installSingleLinePointerGeometry(session, block);

    paragraph.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        detail: 1,
        clientX: 420,
        clientY: 109,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        buttons: 1,
        clientX: 95,
        clientY: 109,
      }),
    );
    document.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 95,
        clientY: 109,
      }),
    );

    expect(session.view.state.selection.empty).toBe(false);
    expect(session.view.state.selection.anchor).toBe(block.contentPmTo);
    expect(session.view.state.selection.head).toBe(block.contentPmFrom + 5);
    session.destroy();
  });

  it("keeps reverse selections intact through mouseup publication", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const source = "Hello world today\n";
    const projection = buildEditableProjection(source);
    let published: string | null = null;
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 1,
      onSelectionChange: (selection) => {
        published = selection?.expectedText ?? null;
      },
    });

    const from = 1;
    const to = 6;
    session.view.dispatch(
      session.view.state.tr.setSelection(
        TextSelection.create(session.view.state.doc, to, from),
      ),
    );
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
  });

  it("locates thematic break clicks back to the source line", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "before\n\n---\n\nafter\n";
    const projection = buildEditableProjection(source);
    const breakBlock = projection.sourceMap.blocks.find(
      (block) => block.nodeType === "thematicBreak",
    )!;
    const located: number[] = [];
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 1,
      onLocateSource: (line) => {
        located.push(line);
      },
    });

    expect(host.querySelector("hr")).toBeTruthy();
    expect(host.textContent).not.toContain("分隔线");

    vi.spyOn(session.view, "posAtCoords").mockReturnValue({
      pos: breakBlock.pmFrom,
      inside: breakBlock.pmFrom,
    });
    const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    session.view.dom.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 100,
        ...(isApple
          ? { metaKey: true, ctrlKey: false }
          : { metaKey: false, ctrlKey: true }),
      }),
    );

    expect(located).toEqual([breakBlock.sourceLine]);
    session.destroy();
  });

  it("keeps relative caret after rebuild without snapping to block start", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world today\n";
    const projection = buildEditableProjection(source);
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
    });

    const segment = projection.sourceMap.segments[0]!;
    const mid = segment.pmFrom + "Hello wo".length;
    session.view.dispatch(
      session.view.state.tr.setSelection(
        TextSelection.create(session.view.state.doc, mid),
      ),
    );
    session.rebuild(buildEditableProjection(source));
    expect(session.view.state.selection.head).toBe(mid);
    session.destroy();
  });

  it("places a source-offset selection for format toolbar recovery", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world today\n";
    const projection = buildEditableProjection(source);
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
    });

    const from = source.indexOf("world");
    const to = from + 5;
    expect(session.setSourceSelection(from, to)).toBe(true);
    const selection = session.getFormatSelection();
    expect(selection).toMatchObject({ from, to });
    session.destroy();
  });
});
