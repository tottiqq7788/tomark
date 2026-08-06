import { afterEach, describe, expect, it, vi } from "vitest";
import { undo, undoDepth } from "@codemirror/commands";
import { createEditor, type EditorHandle } from "@/editor/createEditor";
import { headingFoldField } from "@/editor/headingFoldExtension";

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
      metaKey: true,
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
});
