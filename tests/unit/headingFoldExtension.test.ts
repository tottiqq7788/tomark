import { describe, expect, it, vi } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import {
  classifyHeadingRebuild,
  applyDefaultHeadingFoldsEffect,
  headingFoldExtensions,
  headingFoldField,
  headingForSourceLine,
  revealSourceLineEffect,
  toggleHeadingFold,
} from "@/editor/headingFoldExtension";
import * as headingTree from "@/editor/headingTree";

describe("headingFoldExtension", () => {
  it("expands the first-child heading chain by default", () => {
    const state = EditorState.create({
      doc: "# A\n## A1\n### A1a\nbody\n## A2\nx\n# B\ny\n",
      extensions: headingFoldExtensions(),
    });
    const fold = state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(false);
    expect(fold.headingLines.get(2)).toBe(false);
    expect(fold.headingLines.get(3)).toBe(false);
    expect(fold.headingLines.get(5)).toBe(true);
    expect(fold.headingLines.get(7)).toBe(true);
  });

  it("expands only the first root when there are multiple top-level headings", () => {
    const state = EditorState.create({
      doc: "# A\nbody A\n# B\nbody B\n# C\nbody C\n",
      extensions: headingFoldExtensions(),
    });
    const fold = state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(false);
    expect(fold.headingLines.get(3)).toBe(true);
    expect(fold.headingLines.get(5)).toBe(true);
  });

  it("reapplies the default first-child chain on resetHeadingFolds", () => {
    let state = EditorState.create({
      doc: "# A\n## A1\nbody\n## A2\nx\n# B\ny\n",
      extensions: headingFoldExtensions(),
    });
    state = state.update({ effects: toggleHeadingFold.of(2) }).state;
    state = state.update({ effects: toggleHeadingFold.of(4) }).state;
    state = state.update({ effects: applyDefaultHeadingFoldsEffect() }).state;

    const fold = state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(false);
    expect(fold.headingLines.get(2)).toBe(false);
    expect(fold.headingLines.get(4)).toBe(true);
    expect(fold.headingLines.get(6)).toBe(true);
  });

  it("keeps fold state on the same headings after inserting a sibling", () => {
    let state = EditorState.create({
      doc: "# Root\n## A\nbody A\n## B\nbody B\n",
      extensions: headingFoldExtensions(),
    });

    state = state.update({ effects: toggleHeadingFold.of(2) }).state;
    state = state.update({
      changes: {
        from: state.doc.line(2).from,
        insert: "## New\nnew body\n",
      },
    }).state;

    const foldState = state.field(headingFoldField);
    expect(foldState.headingLines.get(1)).toBe(false);
    expect(foldState.headingLines.get(2)).toBe(false);
    expect(foldState.headingLines.get(4)).toBe(true);
    expect(foldState.headingLines.get(6)).toBe(true);
  });

  it("reuses the heading tree for plain body edits", () => {
    const spy = vi.spyOn(headingTree, "buildHeadingTreeFromDoc");
    let state = EditorState.create({
      doc: "# Root\n\nbody line\n",
      extensions: headingFoldExtensions(),
    });
    const created = spy.mock.calls.length;
    const bodyPos = state.doc.line(3).from + 4;
    const tr = state.update({
      changes: { from: bodyPos, insert: "x" },
    });
    expect(classifyHeadingRebuild(tr, state.field(headingFoldField))).toBe(
      "reuse",
    );
    state = tr.state;
    expect(spy.mock.calls.length).toBe(created);
    spy.mockRestore();
  });

  it("fully rebuilds when a heading line is edited", () => {
    const spy = vi.spyOn(headingTree, "buildHeadingTreeFromDoc");
    let state = EditorState.create({
      doc: "# Root\n\nbody\n",
      extensions: headingFoldExtensions(),
    });
    const created = spy.mock.calls.length;

    state = state.update({
      changes: {
        from: state.doc.line(1).to,
        insert: "er",
      },
    }).state;

    expect(spy.mock.calls.length).toBeGreaterThan(created);
    expect(state.field(headingFoldField).flat[0].text).toBe("Rooter");
    spy.mockRestore();
  });

  it("fully rebuilds when the middle of a multiline setext heading is edited", () => {
    let state = EditorState.create({
      doc: "first\nsecond\nthird\n---\nbody\n",
      extensions: headingFoldExtensions(),
    });
    const tr = state.update({
      changes: {
        from: state.doc.line(2).from,
        to: state.doc.line(2).to,
        insert: "",
      },
    });

    expect(classifyHeadingRebuild(tr, state.field(headingFoldField))).toBe(
      "full",
    );
    state = tr.state;
    expect(state.field(headingFoldField).flat[0].line).toBe(3);
  });

  it("builds headings from Text without splitting the whole document string", () => {
    const doc = Text.of(["# One", "", "## Two", "body"]);
    const roots = headingTree.buildHeadingTreeFromDoc(doc);
    expect(roots).toHaveLength(1);
    expect(roots[0].children[0].text).toBe("Two");
  });

  it("collapses sibling branches when expanding another leaf on the same path", () => {
    let state = EditorState.create({
      doc: "# 1\n## 1.2\n### 1.2.2\nbody\n### 1.2.3\nx\n# 2\ny\n",
      extensions: headingFoldExtensions(),
    });
    state = state.update({ effects: toggleHeadingFold.of(5) }).state;
    let fold = state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(false);
    expect(fold.headingLines.get(2)).toBe(false);
    expect(fold.headingLines.get(3)).toBe(true);
    expect(fold.headingLines.get(5)).toBe(false);
    expect(fold.headingLines.get(7)).toBe(true);

    state = state.update({ effects: toggleHeadingFold.of(7) }).state;
    fold = state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(true);
    expect(fold.headingLines.get(2)).toBe(true);
    expect(fold.headingLines.get(3)).toBe(true);
    expect(fold.headingLines.get(5)).toBe(true);
    expect(fold.headingLines.get(7)).toBe(false);
  });

  it("collapses descendants when expanding an ancestor on the path", () => {
    let state = EditorState.create({
      doc: "# A\n## A1\n### A1a\nbody\n## A2\nx\n",
      extensions: headingFoldExtensions(),
    });
    state = state.update({ effects: toggleHeadingFold.of(5) }).state;
    state = state.update({ effects: toggleHeadingFold.of(2) }).state;
    const fold = state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(false);
    expect(fold.headingLines.get(2)).toBe(false);
    expect(fold.headingLines.get(3)).toBe(true);
    expect(fold.headingLines.get(5)).toBe(true);
  });

  it("collapses only the clicked heading when folding an open node", () => {
    let state = EditorState.create({
      doc: "# A\n## A1\n### A1a\nbody\n## A2\nx\n",
      extensions: headingFoldExtensions(),
    });
    state = state.update({ effects: toggleHeadingFold.of(2) }).state;
    const fold = state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(false);
    expect(fold.headingLines.get(2)).toBe(true);
    expect(fold.headingLines.get(3)).toBe(true);
    expect(fold.headingLines.get(5)).toBe(true);
  });

  it("reveals a nested body line by exclusive-expanding its deepest heading", () => {
    let state = EditorState.create({
      doc: "# A\n## A1\n### A1a\nhidden body\n## A2\nx\n# B\ny\n",
      extensions: headingFoldExtensions(),
    });
    state = state.update({ effects: toggleHeadingFold.of(7) }).state;
    expect(state.field(headingFoldField).headingLines.get(1)).toBe(true);

    const flat = state.field(headingFoldField).flat;
    const target = headingForSourceLine(flat, 4);
    expect(target?.text).toBe("A1a");

    state = state.update({ effects: revealSourceLineEffect.of(4) }).state;
    const fold = state.field(headingFoldField);
    expect(fold.headingLines.get(1)).toBe(false);
    expect(fold.headingLines.get(2)).toBe(false);
    expect(fold.headingLines.get(3)).toBe(false);
    expect(fold.headingLines.get(5)).toBe(true);
    expect(fold.headingLines.get(7)).toBe(true);
  });

  it("keeps outline numbers aligned after inserting a sibling heading", () => {
    let state = EditorState.create({
      doc: "# Root\n## A\nbody A\n## B\nbody B\n",
      extensions: headingFoldExtensions(),
    });
    expect(
      state.field(headingFoldField).flat.map((h) =>
        [h.line, h.text, h.path.join(".")].join(":"),
      ),
    ).toEqual(["1:Root:0", "2:A:0.0", "4:B:0.1"]);

    state = state.update({
      changes: {
        from: state.doc.line(2).from,
        insert: "## New\nnew body\n",
      },
    }).state;

    const fold = state.field(headingFoldField);
    expect(
      fold.flat.map((h) => [h.line, h.text, h.path.map((n) => n + 1).join(".")].join(":")),
    ).toEqual(["1:Root:1", "2:New:1.1", "4:A:1.2", "6:B:1.3"]);
  });
});
