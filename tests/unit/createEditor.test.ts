import { afterEach, describe, expect, it } from "vitest";
import { undo, undoDepth } from "@codemirror/commands";
import { createEditor, type EditorHandle } from "@/editor/createEditor";

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
});
