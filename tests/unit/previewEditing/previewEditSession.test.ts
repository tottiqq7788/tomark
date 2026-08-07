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
import { applySourcePatches } from "@/shared/previewEditing";
import type { SourcePatchTransaction } from "@/shared/previewEditing";

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

  it("commits a typing patch through applySourceTransaction", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world\n";
    const projection = buildEditableProjection(source);
    const applied: SourcePatchTransaction[] = [];
    let revision = 0;

    const session = createPreviewEditSession(host, projection, {
      getRevision: () => revision,
      applySourceTransaction: (transaction) => {
        applied.push(transaction);
        revision += 1;
        return {
          ok: true,
          revision,
          value:
            source.slice(0, transaction.patches[0]!.from) +
            transaction.patches[0]!.insert +
            source.slice(transaction.patches[0]!.to),
        };
      },
      onStatus: vi.fn(),
    });

    const segment = projection.sourceMap.segments[0]!;
    const pos = segment.pmFrom + "Hello ".length;
    const tr = session.view.state.tr.insertText("X", pos, pos);
    session.view.dispatch(tr);

    expect(applied).toHaveLength(1);
    expect(applied[0]?.origin).toBe("typing");
    expect(applied[0]?.patches[0]?.insert).toContain("X");
    session.destroy();
  });

  it("rejects edits that touch read-only atoms without writing source", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "before `code` after\n";
    const projection = buildEditableProjection(source);
    const apply = vi.fn();
    const onStatus = vi.fn();

    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
      applySourceTransaction: apply,
      onStatus,
    });

    const readonly = projection.sourceMap.segments.find(
      (segment) => segment.policy === "read-only",
    );
    expect(readonly).toBeTruthy();
    const tr = session.view.state.tr.insertText(
      "!",
      readonly!.pmFrom,
      readonly!.pmTo,
    );
    session.view.dispatch(tr);

    expect(apply).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalled();
    session.destroy();
  });

  it("maps a non-collapsed selection to source offsets", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world today\n";
    const projection = buildEditableProjection(source);
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
      applySourceTransaction: () => ({
        ok: false,
        reason: "stale-revision",
        revision: 0,
      }),
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
      applySourceTransaction: () => ({
        ok: false,
        reason: "stale-revision",
        revision: 0,
      }),
    });
    session.focus();
    expect(host.querySelector(".tm-preview-focus")).toBeNull();
    expect(getComputedStyle(session.view.dom).outlineStyle === "none" ||
      getComputedStyle(session.view.dom).outlineWidth === "0px").toBe(true);
    session.destroy();
  });

  it("keeps rapid consecutive keystrokes without rolling back the prior commit", () => {
    host = document.createElement("div");
    document.body.append(host);
    let source = "Hello world\n";
    let revision = 0;
    const applied: string[] = [];

    const session = createPreviewEditSession(
      host,
      buildEditableProjection(source),
      {
        getRevision: () => revision,
        applySourceTransaction: (transaction) => {
          const next = applySourcePatches(source, transaction.patches);
          source = next;
          revision += 1;
          applied.push(next);
          return { ok: true, revision, value: next };
        },
      },
    );

    const firstSeg = buildEditableProjection("Hello world\n").sourceMap
      .segments[0]!;
    const insertAt = firstSeg.pmFrom + "Hello ".length;
    // insertText alone does not move an untouched selection — place the caret
    // first, matching real keyboard input.
    session.view.dispatch(
      session.view.state.tr
        .setSelection(TextSelection.create(session.view.state.doc, insertAt))
        .insertText("X"),
    );
    expect(applied[0]).toContain("Hello Xworld");

    // Second keystroke must translate against the accepted projection.
    const head = session.view.state.selection.head;
    session.view.dispatch(session.view.state.tr.insertText("Y", head, head));
    expect(applied).toHaveLength(2);
    expect(applied[1]).toContain("Hello XYworld");
    session.destroy();
  });

  it("recovers selection exactly at wrapper boundaries without fuzzy snap", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello **world** today\n";
    const projection = buildEditableProjection(source);
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
      applySourceTransaction: () => ({
        ok: false,
        reason: "stale-revision",
        revision: 0,
      }),
    });

    const worldIndex = source.indexOf("world");
    // Exact offset inside the bold label.
    session.rebuild(buildEditableProjection(source), {
      selection: { anchor: worldIndex, head: worldIndex },
    });
    const mapped = session.view.state.selection.head;
    const segment = projection.sourceMap.segments.find(
      (item) => item.text === "world",
    )!;
    expect(mapped).toBe(segment.pmFrom);

    // Mid-delimiter offset (second `*`) has no exact editable map — fall back
    // to the block content start instead of snapping ±2 onto "world".
    const innerStarOffset = source.indexOf("**") + 1;
    const block = projection.sourceMap.blocks.find(
      (item) => item.policy === "editable",
    )!;
    session.rebuild(buildEditableProjection(source), {
      selection: { anchor: innerStarOffset, head: innerStarOffset },
    });
    expect(session.view.state.selection.head).toBe(block.contentPmFrom);
    expect(session.view.state.selection.head).not.toBe(segment.pmFrom);
    session.destroy();
  });

  it("keeps the optimistic caret after a successful typing commit", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world\n";
    let current = source;
    const projection = buildEditableProjection(source);
    let revision = 0;

    const session = createPreviewEditSession(host, projection, {
      getRevision: () => revision,
      applySourceTransaction: (transaction) => {
        current = applySourcePatches(current, transaction.patches);
        revision += 1;
        return { ok: true, revision, value: current };
      },
    });

    const segment = projection.sourceMap.segments[0]!;
    const pos = segment.pmFrom + "Hello ".length;
    session.view.dispatch(
      session.view.state.tr
        .setSelection(TextSelection.create(session.view.state.doc, pos))
        .insertText("X"),
    );

    expect(session.view.state.selection.head).toBe(pos + 1);
    expect(current).toContain("Hello Xworld");
    session.destroy();
  });

  it("flushes pending composition before Enter splits a block", () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world\n";
    let current = source;
    const projection = buildEditableProjection(source);
    const applied: SourcePatchTransaction[] = [];
    let revision = 0;

    const session = createPreviewEditSession(host, projection, {
      getRevision: () => revision,
      applySourceTransaction: (transaction) => {
        applied.push(transaction);
        current = applySourcePatches(current, transaction.patches);
        revision += 1;
        return { ok: true, revision, value: current };
      },
    });

    const segment = projection.sourceMap.segments[0]!;
    const pos = segment.pmFrom + "Hello ".length;
    session.view.dispatch(
      session.view.state.tr.setSelection(
        TextSelection.create(session.view.state.doc, pos),
      ),
    );
    session.view.dom.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    session.view.dispatch(session.view.state.tr.insertText("你"));
    expect(session.isComposing()).toBe(true);

    // Enter while composition is still open must flush composed text first.
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    session.view.someProp("handleKeyDown", (f) => f(session.view, enter));

    expect(applied.some((item) => item.origin === "composition")).toBe(true);
    expect(applied.some((item) => item.origin === "structure")).toBe(true);
    expect(current).toContain("你");
    // Synthetic compositionstart can leave view.composing true until compositionend;
    // the important contract is that Enter already flushed and committed the text.
    session.view.dom.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    session.flushComposition();
    expect(session.isComposing()).toBe(false);
    session.destroy();
  });

  it("rolls the view back when composition commit fails", async () => {
    host = document.createElement("div");
    document.body.append(host);
    const source = "Hello world\n";
    const projection = buildEditableProjection(source);
    const onStatus = vi.fn();
    const session = createPreviewEditSession(host, projection, {
      getRevision: () => 0,
      applySourceTransaction: () => ({
        ok: false,
        reason: "expected-text-mismatch",
        revision: 0,
      }),
      onStatus,
    });

    session.view.dom.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const segment = projection.sourceMap.segments[0]!;
    const pos = segment.pmFrom + "Hello ".length;
    // Simulate composed characters landing in the view during IME.
    session.view.dispatch(session.view.state.tr.insertText("你", pos, pos));
    expect(session.isComposing()).toBe(true);

    session.view.dom.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    // Match the production microtask settle used by compositionend.
    await Promise.resolve();
    session.flushComposition();

    expect(onStatus).toHaveBeenCalled();
    expect(session.view.state.doc.textContent).toBe(
      projection.doc.textContent,
    );
    expect(session.isComposing()).toBe(false);
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
      applySourceTransaction: () => ({
        ok: false,
        reason: "stale-revision",
        revision: 0,
      }),
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
      applySourceTransaction: () => ({
        ok: false,
        reason: "stale-revision",
        revision: 0,
      }),
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
    expect(session.view.state.selection.head).toBe(
      block.contentPmFrom + 5,
    );
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
});
