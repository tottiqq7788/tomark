import { describe, expect, it, vi } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import {
  classifyHeadingRebuild,
  collapseAllHeadingsEffect,
  headingFoldExtensions,
  headingFoldField,
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
    // A / A1 / A1a expanded; A2 and B collapsed
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
    // Collapse the open chain leaf, expand a sibling — then reset.
    state = state.update({ effects: toggleHeadingFold.of(2) }).state;
    state = state.update({ effects: toggleHeadingFold.of(4) }).state;
    state = state.update({ effects: collapseAllHeadingsEffect() }).state;

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

    // Default: Root + A expanded, B collapsed. Collapse A, then insert sibling.
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

  it("builds headings from Text without splitting the whole document string", () => {
    const doc = Text.of(["# One", "", "## Two", "body"]);
    const roots = headingTree.buildHeadingTreeFromDoc(doc);
    expect(roots).toHaveLength(1);
    expect(roots[0].children[0].text).toBe("Two");
  });
});
