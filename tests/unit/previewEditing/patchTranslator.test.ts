import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import {
  buildEditableProjection,
  type EditableProjection,
  type ProjectionSourceSegment,
} from "@/markdown/buildEditableProjection";
import { applySourcePatches } from "@/shared/previewEditing";
import { escapeMarkdownText } from "@/preview/editing/markdownTextEscaping";
import {
  structureCommandToSourcePatches,
  transactionToSourcePatches,
  type PatchTranslationResult,
} from "@/preview/editing/transactionToSourcePatches";

function segment(
  projection: EditableProjection,
  text: string,
  context?: ProjectionSourceSegment["context"],
): ProjectionSourceSegment {
  const found = projection.sourceMap.segments.find(
    (candidate) =>
      candidate.text === text &&
      candidate.policy === "editable" &&
      (!context || candidate.context === context),
  );
  if (!found) {
    throw new Error(`Missing editable segment: ${text}`);
  }
  return found;
}

function output(
  projection: EditableProjection,
  result: PatchTranslationResult,
): string {
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) {
    return projection.parsed.source;
  }
  return applySourcePatches(
    projection.parsed.source,
    result.sourceTransaction.patches,
  );
}

describe("Markdown text escaping", () => {
  it("escapes inline syntax and table separators minimally", () => {
    expect(escapeMarkdownText("* [x] `y` &amp;")).toBe(
      "\\* \\[x\\] \\`y\\` \\&amp;",
    );
    expect(
      escapeMarkdownText("a | b", { context: "table-cell" }),
    ).toBe("a \\| b");
    expect(escapeMarkdownText("a | b")).toBe("a | b");
    expect(escapeMarkdownText("~~x~~")).toBe("\\~\\~x\\~\\~");
  });

  it("protects block markers only at a visual line start", () => {
    expect(escapeMarkdownText("# title", { atLineStart: true })).toBe(
      "\\# title",
    );
    expect(escapeMarkdownText("1. item", { atLineStart: true })).toBe(
      "1\\. item",
    );
    expect(escapeMarkdownText("---", { atLineStart: true })).toBe("\\---");
    expect(escapeMarkdownText("===", { atLineStart: true })).toBe("\\===");
    expect(escapeMarkdownText("1. item")).toBe("1. item");
  });
});

describe("ProseMirror text transaction translation", () => {
  it("escapes typed Markdown while preserving untouched source", () => {
    const projection = buildEditableProjection("hello");
    const text = segment(projection, "hello");
    const state = EditorState.create({ doc: projection.doc });
    const transaction = state.tr.insertText("*[x]", text.pmTo);
    const result = transactionToSourcePatches({
      projection,
      transaction,
      revision: 3,
      origin: "typing",
    });

    expect(output(projection, result)).toBe("hello\\*\\[x\\]");
    if (result.ok) {
      expect(result.sourceTransaction.revision).toBe(3);
      expect(result.sourceTransaction.patches).toHaveLength(1);
      expect(result.sourceTransaction.patches[0]).toMatchObject({
        from: 5,
        to: 5,
        expectedText: "",
      });
    }
  });

  it("changes only an explicit link label and leaves URL/title byte-identical", () => {
    const source = "go [label](https://example.test/a_b \"title\") now";
    const projection = buildEditableProjection(source);
    const label = segment(projection, "label", "link-label");
    const state = EditorState.create({ doc: projection.doc });
    const result = transactionToSourcePatches({
      projection,
      transaction: state.tr.insertText("next", label.pmFrom, label.pmTo),
      revision: 0,
      origin: "typing",
    });
    const next = output(projection, result);

    expect(next).toBe("go [next](https://example.test/a_b \"title\") now");
    expect(next.slice(next.indexOf("]"))).toBe(
      source.slice(source.indexOf("]")),
    );
  });

  it("removes touched empty format wrappers with separate local patches", () => {
    const projection = buildEditableProjection("a **bold** z");
    const bold = segment(projection, "bold");
    const state = EditorState.create({ doc: projection.doc });
    const result = transactionToSourcePatches({
      projection,
      transaction: state.tr.delete(bold.pmFrom, bold.pmTo),
      revision: 0,
      origin: "typing",
    });

    expect(output(projection, result)).toBe("a  z");
    if (result.ok) {
      expect(result.sourceTransaction.patches).toHaveLength(3);
    }
  });

  it("removes an emptied explicit link without touching adjacent text", () => {
    const projection = buildEditableProjection("a [label](https://x.test) z");
    const label = segment(projection, "label", "link-label");
    const state = EditorState.create({ doc: projection.doc });
    const result = transactionToSourcePatches({
      projection,
      transaction: state.tr.delete(label.pmFrom, label.pmTo),
      revision: 0,
      origin: "typing",
    });

    expect(output(projection, result)).toBe("a  z");
  });

  it("translates multiple PM steps back to original source coordinates", () => {
    const projection = buildEditableProjection("one two");
    const text = segment(projection, "one two");
    const state = EditorState.create({ doc: projection.doc });
    const transaction = state.tr
      .insertText("X", text.pmFrom + 1)
      .insertText("Y", text.pmTo + 1);
    const result = transactionToSourcePatches({
      projection,
      transaction,
      revision: 0,
      origin: "typing",
    });

    expect(output(projection, result)).toBe("oXne twoY");
    if (result.ok) {
      expect(result.sourceTransaction.patches).toHaveLength(2);
    }
  });

  it("skips format delimiters and removes selected continuation prefixes", () => {
    const formatted = buildEditableProjection("ab **cd** ef");
    const plain = segment(formatted, "ab ");
    const bold = segment(formatted, "cd");
    const formattedState = EditorState.create({ doc: formatted.doc });
    const acrossFormat = transactionToSourcePatches({
      projection: formatted,
      transaction: formattedState.tr.delete(
        plain.pmFrom + 1,
        bold.pmFrom + 1,
      ),
      revision: 0,
      origin: "typing",
    });
    expect(output(formatted, acrossFormat)).toBe("a**d** ef");

    const quote = buildEditableProjection("> one\n> two");
    const quoteSegments = quote.sourceMap.segments.filter(
      (candidate) => candidate.policy === "editable",
    );
    const firstLine = quoteSegments.find((candidate) =>
      candidate.text.endsWith("\n"),
    )!;
    const secondLine = quoteSegments.find(
      (candidate) => candidate.text === "two",
    )!;
    const quoteState = EditorState.create({ doc: quote.doc });
    const acrossLine = transactionToSourcePatches({
      projection: quote,
      transaction: quoteState.tr.delete(
        firstLine.pmTo - 1,
        secondLine.pmFrom + 1,
      ),
      revision: 0,
      origin: "typing",
    });
    expect(output(quote, acrossLine)).toBe("> onewo");
  });

  it("escapes pipes in cells and rejects multiline or atom edits", () => {
    const table = buildEditableProjection(
      "| A |\n| - |\n| x |\n",
    );
    const cell = segment(table, "x", "table-cell");
    const tableState = EditorState.create({ doc: table.doc });
    const pipe = transactionToSourcePatches({
      projection: table,
      transaction: tableState.tr.insertText("|", cell.pmTo),
      revision: 0,
      origin: "typing",
    });
    expect(output(table, pipe)).toContain("x\\|");

    const paragraph = buildEditableProjection("abc");
    const text = segment(paragraph, "abc");
    const paragraphState = EditorState.create({ doc: paragraph.doc });
    expect(
      transactionToSourcePatches({
        projection: paragraph,
        transaction: paragraphState.tr.insertText("x\ny", text.pmTo),
        revision: 0,
        origin: "paste",
      }),
    ).toMatchObject({
      ok: false,
      reason: "structural-command-required",
    });

    const code = buildEditableProjection("a `code` b");
    const atom = code.sourceMap.segments.find(
      (candidate) => candidate.nodeType === "inlineCode",
    )!;
    const codeState = EditorState.create({ doc: code.doc });
    expect(
      transactionToSourcePatches({
        projection: code,
        transaction: codeState.tr.insertText("x", atom.pmFrom, atom.pmTo),
        revision: 0,
        origin: "typing",
      }),
    ).toMatchObject({ ok: false, reason: "read-only" });
  });

  it("rejects a transaction built from a different projection", () => {
    const projection = buildEditableProjection("one");
    const other = buildEditableProjection("two");
    const otherState = EditorState.create({ doc: other.doc });

    expect(
      transactionToSourcePatches({
        projection,
        transaction: otherState.tr.insertText("!", 2),
        revision: 0,
        origin: "typing",
      }),
    ).toMatchObject({ ok: false, reason: "stale-projection" });
  });
});

describe("explicit Markdown structure commands", () => {
  function split(source: string, visible: string, offset: number): string {
    const projection = buildEditableProjection(source);
    const text = segment(projection, visible);
    const result = structureCommandToSourcePatches({
      projection,
      revision: 0,
      command: {
        type: "split-block",
        pmPosition: text.pmFrom + offset,
      },
    });
    return output(projection, result);
  }

  it("splits paragraphs with the document newline convention", () => {
    expect(split("alphabeta", "alphabeta", 5)).toBe("alpha\n\nbeta");
    expect(split("alphabeta\r\n", "alphabeta", 5)).toBe(
      "alpha\r\n\r\nbeta\r\n",
    );
    expect(split("**alphabeta**", "alphabeta", 5)).toBe(
      "**alpha**\n\n**beta**",
    );
    expect(split("**abc**", "abc", 0)).toBe("\n\n**abc**");
    expect(split("**abc**", "abc", 3)).toBe("**abc**\n\n");
  });

  it("places the caret at the start of the new block body after Enter", () => {
    const projection = buildEditableProjection("alphabeta");
    const text = segment(projection, "alphabeta");
    const result = structureCommandToSourcePatches({
      projection,
      revision: 0,
      command: {
        type: "split-block",
        pmPosition: text.pmFrom + 5,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.sourceTransaction.selection).toEqual({
      anchor: "alpha\n\n".length,
      head: "alpha\n\n".length,
    });

    const list = buildEditableProjection("* alphabeta");
    const listText = segment(list, "alphabeta");
    const listSplit = structureCommandToSourcePatches({
      projection: list,
      revision: 0,
      command: {
        type: "split-block",
        pmPosition: listText.pmFrom + 5,
      },
    });
    expect(listSplit.ok).toBe(true);
    if (!listSplit.ok) {
      return;
    }
    expect(listSplit.sourceTransaction.selection).toEqual({
      anchor: "* alpha\n* ".length,
      head: "* alpha\n* ".length,
    });
  });

  it("keeps ATX/Setext heading syntax on the first half", () => {
    expect(split("# alphabeta #", "alphabeta", 5)).toBe(
      "# alpha #\nbeta",
    );
    expect(split("Title\n===", "Title", 2)).toBe("Ti\n===\ntle");
    expect(split("# **alphabeta** #", "alphabeta", 5)).toBe(
      "# **alpha** #\n**beta**",
    );
  });

  it("copies list and quote prefixes without normalizing marker style", () => {
    expect(split("* alphabeta", "alphabeta", 5)).toBe(
      "* alpha\n* beta",
    );
    expect(split("> alphabeta", "alphabeta", 5)).toBe(
      "> alpha\n> \n> beta",
    );
    expect(split("- [x] alphabeta", "alphabeta", 5)).toBe(
      "- [x] alpha\n- [ ] beta",
    );
  });

  it("exits an empty list item and rejects table newlines", () => {
    const list = buildEditableProjection("- \n");
    const listBlock = list.sourceMap.blocks.find(
      (block) => block.context.listItem,
    )!;
    const exit = structureCommandToSourcePatches({
      projection: list,
      revision: 0,
      command: {
        type: "split-block",
        pmPosition: listBlock.contentPmFrom,
      },
    });
    expect(output(list, exit)).toBe("\n");

    const table = buildEditableProjection("| A |\n| - |\n| x |\n");
    const cell = segment(table, "x", "table-cell");
    expect(
      structureCommandToSourcePatches({
        projection: table,
        revision: 0,
        command: { type: "split-block", pmPosition: cell.pmTo },
      }),
    ).toMatchObject({ ok: false, reason: "table-structure-read-only" });
  });

  it("joins only provably compatible adjacent text blocks", () => {
    const projection = buildEditableProjection("one\n\ntwo");
    const two = segment(projection, "two");
    const joined = structureCommandToSourcePatches({
      projection,
      revision: 0,
      command: { type: "join-backward", pmPosition: two.pmFrom },
    });
    expect(output(projection, joined)).toBe("onetwo");
    if (joined.ok) {
      expect(joined.sourceTransaction.selection).toEqual({
        anchor: "one".length,
        head: "one".length,
      });
    }

    const bullet = buildEditableProjection("- alpha\n- beta\n");
    const beta = segment(bullet, "beta");
    const bulletJoin = structureCommandToSourcePatches({
      projection: bullet,
      revision: 0,
      command: { type: "join-backward", pmPosition: beta.pmFrom },
    });
    expect(output(bullet, bulletJoin)).toBe("- alphabeta\n");
    if (bulletJoin.ok) {
      expect(bulletJoin.sourceTransaction.selection).toEqual({
        anchor: "- alpha".length,
        head: "- alpha".length,
      });
    }

    const ordered = buildEditableProjection("1. alpha\n2. beta\n");
    const orderedBeta = segment(ordered, "beta");
    const orderedJoin = structureCommandToSourcePatches({
      projection: ordered,
      revision: 0,
      command: { type: "join-backward", pmPosition: orderedBeta.pmFrom },
    });
    expect(output(ordered, orderedJoin)).toBe("1. alphabeta\n");

    const emptyItem = buildEditableProjection("- alpha\n- \n");
    const emptyBlock = emptyItem.sourceMap.blocks
      .filter((block) => block.context.listItem)
      .sort((a, b) => b.pmFrom - a.pmFrom)[0]!;
    const emptyJoin = structureCommandToSourcePatches({
      projection: emptyItem,
      revision: 0,
      command: {
        type: "join-backward",
        pmPosition: emptyBlock.contentPmFrom,
      },
    });
    expect(output(emptyItem, emptyJoin)).toBe("- alpha\n");

    const mixed = buildEditableProjection("# one\n\ntwo");
    const mixedTwo = segment(mixed, "two");
    expect(
      structureCommandToSourcePatches({
        projection: mixed,
        revision: 0,
        command: { type: "join-backward", pmPosition: mixedTwo.pmFrom },
      }),
    ).toMatchObject({ ok: false, reason: "incompatible-blocks" });

    const listThenPara = buildEditableProjection("- alpha\n\nbeta\n");
    const para = segment(listThenPara, "beta");
    expect(
      structureCommandToSourcePatches({
        projection: listThenPara,
        revision: 0,
        command: { type: "join-backward", pmPosition: para.pmFrom },
      }),
    ).toMatchObject({ ok: false, reason: "incompatible-blocks" });
  });
});
