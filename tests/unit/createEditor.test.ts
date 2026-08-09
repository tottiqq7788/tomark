import { afterEach, describe, expect, it, vi } from "vitest";
import { undo, undoDepth } from "@codemirror/commands";
import { createEditor, type EditorHandle } from "@/editor/createEditor";
import {
  headingFoldField,
  toggleHeadingFold,
} from "@/editor/headingFoldExtension";

function locateModifierInit(): { metaKey: boolean; ctrlKey: boolean } {
  const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
  return isApple
    ? { metaKey: true, ctrlKey: false }
    : { metaKey: false, ctrlKey: true };
}

describe("createEditor", () => {
  let editor: EditorHandle | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = null;
    host = null;
  });

  it("clears undo history when replacing the whole document", () => {
    host = document.createElement("div");
    document.body.append(host);
    editor = createEditor({
      parent: host,
      doc: "# Old\n",
      onChange: () => undefined,
      onLocate: () => undefined,
    });

    editor.view.dispatch({
      changes: { from: editor.view.state.doc.length, insert: "changed" },
    });
    expect(undoDepth(editor.view.state)).toBe(1);

    editor.setDocument("# New\n");

    expect(editor.getValue()).toBe("# New\n");
    expect(undoDepth(editor.view.state)).toBe(0);
    expect(undo(editor.view)).toBe(false);
  });

  it("routes clipboard image paste to onPasteImage and blocks default", () => {
    host = document.createElement("div");
    document.body.append(host);
    const onPasteImage = vi.fn();
    editor = createEditor({
      parent: host,
      doc: "hello\n",
      onChange: () => undefined,
      onLocate: () => undefined,
      onPasteImage,
    });

    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const clipboardData = {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => file,
        },
      ],
      files: [] as unknown as FileList,
      getData: () => "",
      types: ["Files"],
    } as unknown as DataTransfer;
    const event = new Event("paste", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: clipboardData,
    });
    const dispatched = editor.view.contentDOM.dispatchEvent(event);
    expect(dispatched).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(onPasteImage).toHaveBeenCalledTimes(1);
    expect(onPasteImage.mock.calls[0]?.[0]).toBe(file);
  });

  it("calls onLocate for Cmd/Ctrl+click on a source line", () => {
    host = document.createElement("div");
    document.body.append(host);
    const onLocate = vi.fn();
    editor = createEditor({
      parent: host,
      doc: "# Title\n\nbody line\n",
      onChange: () => undefined,
      onLocate,
    });

    const line = editor.view.state.doc.line(3);
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue(line.from);
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
      ...locateModifierInit(),
    });
    editor.view.contentDOM.dispatchEvent(event);
    expect(onLocate).toHaveBeenCalledWith(3);
  });

  it("revealSourceLine expands the exclusive path to a nested line", () => {
    host = document.createElement("div");
    document.body.append(host);
    editor = createEditor({
      parent: host,
      doc: "# A\n## A1\n### A1a\nhidden\n## A2\nx\n# B\ny\n",
      onChange: () => undefined,
      onLocate: () => undefined,
    });

    editor.revealSourceLine(4);
    const fold = editor.view.state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(false);
    expect(fold.headingLines.get(3)).toBe(false);
    expect(fold.headingLines.get(7)).toBe(true);
  });

  it("exposes requestMeasure for layout refresh", () => {
    host = document.createElement("div");
    document.body.append(host);
    editor = createEditor({
      parent: host,
      doc: "hello\n",
      onChange: () => undefined,
      onLocate: () => undefined,
    });
    const spy = vi.spyOn(editor.view, "requestMeasure");
    editor.requestMeasure();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("applies a format change as one undoable transaction", () => {
    host = document.createElement("div");
    document.body.append(host);
    editor = createEditor({
      parent: host,
      doc: "Hello world\n",
      onChange: () => undefined,
      onLocate: () => undefined,
    });

    expect(
      editor.applyFormatChange({
        from: 6,
        to: 11,
        insert: "**world**",
        selectionFrom: 8,
        selectionTo: 13,
      }),
    ).toBe(true);
    expect(editor.getValue()).toBe("Hello **world**\n");
    expect(undoDepth(editor.view.state)).toBe(1);
    expect(undo(editor.view)).toBe(true);
    expect(editor.getValue()).toBe("Hello world\n");
  });

  it("rejects format changes when expectedText no longer matches", () => {
    host = document.createElement("div");
    document.body.append(host);
    editor = createEditor({
      parent: host,
      doc: "Hello world\n",
      onChange: () => undefined,
      onLocate: () => undefined,
    });

    expect(
      editor.applyFormatChange({
        from: 6,
        to: 11,
        insert: "**world**",
        expectedText: "other",
      }),
    ).toBe(false);
    expect(editor.getValue()).toBe("Hello world\n");
  });

  it("supports undo and redo for format changes", () => {
    host = document.createElement("div");
    document.body.append(host);
    editor = createEditor({
      parent: host,
      doc: "Hello world\n",
      onChange: () => undefined,
      onLocate: () => undefined,
    });

    expect(
      editor.applyFormatChange({
        from: 6,
        to: 11,
        insert: "**world**",
        selectionFrom: 8,
        selectionTo: 13,
      }),
    ).toBe(true);
    expect(editor.getValue()).toBe("Hello **world**\n");
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe("Hello world\n");
    expect(editor.redo()).toBe(true);
    expect(editor.getValue()).toBe("Hello **world**\n");
  });

  it("shows outline numbers only on heading lines and toggles on click", () => {
    host = document.createElement("div");
    document.body.append(host);
    editor = createEditor({
      parent: host,
      doc: "# Root\n\nbody line\n## Child\nmore\n# Other\ntail\n",
      onChange: () => undefined,
      onLocate: () => undefined,
    });

    expect(host.querySelector(".cm-lineNumbers")).toBeNull();
    expect(host.querySelector(".cm-heading-fold-gutter")).toBeNull();
    expect(host.querySelector(".cm-heading-number-gutter")).toBeTruthy();

    const markers = [
      ...host.querySelectorAll<HTMLButtonElement>(".cm-heading-number-marker"),
    ];
    expect(markers.map((marker) => marker.textContent)).toEqual([
      "1",
      "1.1",
      "2",
    ]);
    expect(
      markers.map((marker) =>
        marker.classList.contains("cm-heading-number-marker--expanded"),
      ),
    ).toEqual([true, true, false]);
    expect(
      markers.map((marker) =>
        marker.classList.contains("cm-heading-number-marker--collapsed"),
      ),
    ).toEqual([false, false, true]);

    // jsdom lacks gutter hit-testing geometry; exercise the same effect the
    // gutter click handler dispatches, then assert marker classes refresh.
    editor.view.dispatch({
      effects: toggleHeadingFold.of(4),
    });
    const fold = editor.view.state.field(headingFoldField);
    expect(fold.headingLines.get(4)).toBe(true);
    const after = host.querySelector(
      '.cm-heading-number-marker[aria-label="展开标题 1.1"]',
    );
    expect(after?.classList.contains("cm-heading-number-marker--collapsed")).toBe(
      true,
    );
  });
});
