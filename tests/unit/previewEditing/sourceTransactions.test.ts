import { afterEach, describe, expect, it } from "vitest";
import { undoDepth } from "@codemirror/commands";
import { EditorState } from "prosemirror-state";
import { createEditor, type EditorHandle } from "@/editor/createEditor";
import { buildEditableProjection } from "@/markdown/buildEditableProjection";
import { transactionToSourcePatches } from "@/preview/editing/transactionToSourcePatches";
import {
  applySourcePatches,
  validateSourcePatchTransaction,
  type SourcePatch,
} from "@/shared/previewEditing";

describe("source patch validation", () => {
  it("sorts non-overlapping patches and preserves untouched source", () => {
    const source = "alpha beta gamma";
    const patches: SourcePatch[] = [
      { from: 11, to: 16, insert: "G", expectedText: "gamma" },
      { from: 0, to: 5, insert: "A", expectedText: "alpha" },
    ];
    const result = validateSourcePatchTransaction(source, 4, {
      revision: 4,
      origin: "typing",
      patches,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.patches.map((patch) => patch.from)).toEqual([0, 11]);
      expect(applySourcePatches(source, result.patches)).toBe("A beta G");
    }
    expect(source.slice(5, 11)).toBe(" beta ");
  });

  it("rejects overlap, stale revisions, mismatched text, and ambiguous inserts", () => {
    const source = "abcdef";
    expect(
      validateSourcePatchTransaction(source, 1, {
        revision: 0,
        origin: "typing",
        patches: [{ from: 0, to: 1, insert: "x", expectedText: "a" }],
      }),
    ).toMatchObject({ ok: false, reason: "stale-revision" });
    expect(
      validateSourcePatchTransaction(source, 1, {
        revision: 1,
        origin: "typing",
        patches: [
          { from: 1, to: 4, insert: "", expectedText: "bcd" },
          { from: 3, to: 5, insert: "", expectedText: "de" },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "overlapping-patches" });
    expect(
      validateSourcePatchTransaction(source, 1, {
        revision: 1,
        origin: "typing",
        patches: [
          { from: 2, to: 2, insert: "x", expectedText: "" },
          { from: 2, to: 2, insert: "y", expectedText: "" },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "overlapping-patches" });
    expect(
      validateSourcePatchTransaction(source, 1, {
        revision: 1,
        origin: "typing",
        patches: [{ from: 0, to: 1, insert: "x", expectedText: "z" }],
      }),
    ).toMatchObject({ ok: false, reason: "expected-text-mismatch" });
  });
});

describe("CodeMirror source transactions", () => {
  let editor: EditorHandle | null = null;
  let host: HTMLElement | null = null;

  function mount(doc: string): EditorHandle {
    host = document.createElement("div");
    document.body.append(host);
    editor = createEditor({
      parent: host,
      doc,
      onChange: () => undefined,
      onLocate: () => undefined,
    });
    return editor;
  }

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = null;
    host = null;
  });

  it("applies multiple patches in one dispatch and one undo step", () => {
    const instance = mount("alpha beta gamma");
    const result = instance.applySourceTransaction({
      revision: instance.getRevision(),
      origin: "format",
      patches: [
        { from: 11, to: 16, insert: "G", expectedText: "gamma" },
        { from: 0, to: 5, insert: "A", expectedText: "alpha" },
      ],
      selection: { anchor: 8, head: 8 },
    });

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      value: "A beta G",
    });
    expect(instance.view.state.selection.main.head).toBe(8);
    expect(undoDepth(instance.view.state)).toBe(1);
    expect(instance.undo()).toBe(true);
    expect(instance.getValue()).toBe("alpha beta gamma");
    expect(instance.getRevision()).toBe(2);
  });

  it("rejects stale projection and slice guards without dispatching", () => {
    const instance = mount("hello");
    instance.view.dispatch({ changes: { from: 5, insert: "!" } });
    const revision = instance.getRevision();

    expect(
      instance.applySourceTransaction({
        revision: revision - 1,
        origin: "typing",
        patches: [{ from: 0, to: 5, insert: "x", expectedText: "hello" }],
      }),
    ).toMatchObject({ ok: false, reason: "stale-revision" });
    expect(
      instance.applySourceTransaction({
        revision,
        origin: "typing",
        patches: [{ from: 0, to: 5, insert: "x", expectedText: "other" }],
      }),
    ).toMatchObject({ ok: false, reason: "expected-text-mismatch" });
    expect(instance.getValue()).toBe("hello!");
    expect(instance.getRevision()).toBe(revision);
  });

  it("coalesces adjacent typing but isolates paste and structure history", () => {
    const instance = mount("a");
    expect(
      instance.applySourceTransaction({
        revision: 0,
        origin: "typing",
        patches: [{ from: 1, to: 1, insert: "b", expectedText: "" }],
      }).ok,
    ).toBe(true);
    expect(
      instance.applySourceTransaction({
        revision: 1,
        origin: "typing",
        patches: [{ from: 2, to: 2, insert: "c", expectedText: "" }],
      }).ok,
    ).toBe(true);
    expect(undoDepth(instance.view.state)).toBe(1);

    expect(
      instance.applySourceTransaction({
        revision: 2,
        origin: "paste",
        patches: [{ from: 3, to: 3, insert: "d", expectedText: "" }],
      }).ok,
    ).toBe(true);
    expect(undoDepth(instance.view.state)).toBe(2);
    expect(instance.undo()).toBe(true);
    expect(instance.getValue()).toBe("abc");
    expect(instance.undo()).toBe(true);
    expect(instance.getValue()).toBe("a");
  });

  it("applies a translated multi-patch preview edit through unified history", () => {
    const source = "a **bold** z";
    const projection = buildEditableProjection(source);
    const bold = projection.sourceMap.segments.find(
      (segment) => segment.text === "bold",
    )!;
    const pmState = EditorState.create({ doc: projection.doc });
    const translated = transactionToSourcePatches({
      projection,
      transaction: pmState.tr.delete(bold.pmFrom, bold.pmTo),
      revision: 0,
      origin: "typing",
    });
    expect(translated.ok).toBe(true);
    if (!translated.ok) {
      return;
    }

    const instance = mount(source);
    expect(
      instance.applySourceTransaction(translated.sourceTransaction),
    ).toMatchObject({ ok: true, value: "a  z" });
    expect(undoDepth(instance.view.state)).toBe(1);
    expect(instance.undo()).toBe(true);
    expect(instance.getValue()).toBe(source);
  });
});
