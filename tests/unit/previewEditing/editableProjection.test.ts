import { DOMSerializer } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import {
  buildEditableProjection,
  type ProjectionSourceSegment,
} from "@/markdown/buildEditableProjection";
import { parseMarkdownDocument } from "@/markdown/parseMarkdownDocument";
import { renderMarkdown } from "@/markdown/renderMarkdown";
import { editablePreviewSchema } from "@/preview/editing/schema";

function editableSegments(source: string): ProjectionSourceSegment[] {
  return buildEditableProjection(source).sourceMap.segments.filter(
    (segment) => segment.policy === "editable",
  );
}

describe("editable Markdown projection", () => {
  it("keeps declared text and atom nodes as true ProseMirror leaves", () => {
    for (const name of [
      "text",
      "readonly_inline",
      "readonly_block",
      "hard_break",
      "thematic_break",
    ]) {
      const type = editablePreviewSchema.nodes[name]!;
      expect(type.isLeaf, name).toBe(true);
      if (name !== "text") {
        expect(type.create().nodeSize, name).toBe(1);
      }
    }
  });

  it("projects thematic breaks as real readonly hr nodes", () => {
    const source = "before\n\n---\n\nafter\n";
    const projection = buildEditableProjection(source);
    const breakNode = [...Array(projection.doc.childCount)]
      .map((_, index) => projection.doc.child(index))
      .find((child) => child.type.name === "thematic_break");

    expect(breakNode).toBeTruthy();
    expect(projection.doc.textContent).not.toContain("分隔线");
    expect(
      projection.sourceMap.blocks.some(
        (block) =>
          block.nodeType === "thematicBreak" && block.policy === "read-only",
      ),
    ).toBe(true);

    const serializer = DOMSerializer.fromSchema(editablePreviewSchema);
    const dom = serializer.serializeNode(breakNode!);
    expect(dom.nodeName).toBe("HR");
    expect((dom as HTMLElement).getAttribute("data-tm-readonly")).toContain(
      "thematicBreak",
    );
    expect((dom as HTMLElement).getAttribute("data-tm-from")).toBeTruthy();
  });

  it("parses once for both the projection and sanitized fallback", () => {
    const parsed = parseMarkdownDocument("# Hello\r\n\r\nworld\r\n");
    const projection = buildEditableProjection(parsed);
    const rendered = renderMarkdown(parsed);

    expect(parsed.lineEnding).toBe("\r\n");
    expect(projection.parsed).toBe(parsed);
    expect(projection.doc.textContent).toBe("Helloworld");
    expect(rendered.html).toContain("<h1");
    expect(rendered.html).toContain("Hello");
  });

  it("maps escapes, entities, continuation prefixes, and UTF-16 offsets", () => {
    const source = [
      "# A &amp; \\* 😀",
      "",
      "> quote",
      "> next",
      "",
    ].join("\n");
    const projection = buildEditableProjection(source);
    const segments = projection.sourceMap.segments;
    const heading = segments.find(
      (segment) => segment.policy === "editable" && segment.text.includes("&"),
    )!;
    const ampIndex = heading.text.indexOf("&");
    const starIndex = heading.text.indexOf("*");

    expect(
      source.slice(
        heading.sourceOffsets[ampIndex],
        heading.sourceOffsets[ampIndex + 1],
      ),
    ).toBe("&amp;");
    expect(
      source.slice(
        heading.sourceOffsets[starIndex],
        heading.sourceOffsets[starIndex + 1],
      ),
    ).toBe("\\*");

    const next = segments.find((segment) => segment.text === "next")!;
    expect(source.slice(next.sourceFrom, next.sourceTo)).toBe("next");
    expect(
      projection.sourceMap.immutableRanges.some(
        (range) => range.text === "> " && range.kind === "block-syntax",
      ),
    ).toBe(true);

    const emojiOffset = heading.text.indexOf("😀");
    expect(emojiOffset).toBeGreaterThanOrEqual(0);
    expect(
      heading.sourceOffsets[emojiOffset + 2]! -
        heading.sourceOffsets[emojiOffset]!,
    ).toBe(2);
  });

  it("records format and explicit-link syntax as immutable gaps", () => {
    const source = "a **bold** and [lab\\*el](https://example.test/a \"t\")";
    const projection = buildEditableProjection(source);
    const strong = projection.sourceMap.wrappers.find(
      (wrapper) => wrapper.kind === "strong",
    )!;
    const link = projection.sourceMap.wrappers.find(
      (wrapper) => wrapper.kind === "link",
    )!;

    expect(
      strong.immutableRanges.map((range) =>
        source.slice(range.from, range.to),
      ),
    ).toEqual(["**", "**"]);
    expect(
      link.immutableRanges.map((range) => source.slice(range.from, range.to)),
    ).toEqual(["[", "](https://example.test/a \"t\")"]);
    expect(
      projection.sourceMap.segments
        .filter((segment) => segment.context === "link-label")
        .map((segment) => segment.text)
        .join(""),
    ).toBe("lab*el");
  });

  it("projects tables and task text while keeping their syntax read-only", () => {
    const source = [
      "- [x] task",
      "",
      "| A | B |",
      "| - | - |",
      "| x | y |",
    ].join("\n");
    const projection = buildEditableProjection(source);
    const task = projection.sourceMap.segments.find(
      (segment) => segment.nodeType === "task-checkbox",
    )!;
    const cells = projection.sourceMap.segments.filter(
      (segment) => segment.context === "table-cell",
    );

    expect(task.policy).toBe("read-only");
    expect(task.sourceText).toBe("[x] ");
    expect(
      projection.sourceMap.immutableRanges.some(
        (range) => range.kind === "task-marker",
      ),
    ).toBe(true);
    expect(cells.map((segment) => segment.text)).toEqual(["A", "B", "x", "y"]);
    expect(projection.doc.toJSON()).toMatchObject({
      type: "doc",
      content: [
        { type: "bullet_list" },
        { type: "table" },
      ],
    });
  });

  it("fails closed for code, images, automatic links, and ambiguous entities", () => {
    const source =
      "`code` ![<b>](x.png) <https://example.test> &#x1F600;";
    const projection = buildEditableProjection(source);
    const readonly = projection.sourceMap.segments.filter(
      (segment) => segment.policy === "read-only",
    );

    expect(readonly.map((segment) => segment.nodeType)).toEqual(
      expect.arrayContaining(["inlineCode", "image", "link", "text"]),
    );
    for (const segment of readonly) {
      expect(
        projection.sourceMap.resolveEditableRange(
          segment.pmFrom,
          segment.pmTo,
        ),
      ).toMatchObject({ ok: false, reason: "read-only" });
    }

    const fragment = DOMSerializer.fromSchema(
      editablePreviewSchema,
    ).serializeFragment(projection.doc.content, { document });
    const host = document.createElement("div");
    host.append(fragment);
    expect(host.querySelector("b")).toBeNull();
    expect(host.textContent).toContain("图片：<b>");
  });

  it("resolves text ranges across immutable format delimiters", () => {
    const source = "a **bold** z";
    const projection = buildEditableProjection(source);
    const segments = editableSegments(source);
    const first = segments.find((segment) => segment.text === "a ")!;
    const bold = segments.find((segment) => segment.text === "bold")!;
    const resolved = projection.sourceMap.resolveEditableRange(
      first.pmFrom + 1,
      bold.pmTo,
    );

    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.slices.map((slice) => slice.expectedText)).toEqual([
        " ",
        "bold",
      ]);
    }
    expect(source.slice(bold.sourceFrom, bold.sourceTo)).toBe("bold");
  });

  it("provides an insertion map for an empty list item", () => {
    const projection = buildEditableProjection("- \n");
    const block = projection.sourceMap.blocks.find(
      (candidate) => candidate.context.listItem,
    )!;
    const mapped = projection.sourceMap.mapPmPosition(
      block.contentPmFrom,
      1,
    );

    expect(mapped?.sourceOffset).toBe(2);
    expect(block.context.linePrefix).toBe("- ");
  });

  it("always produces a schema-valid document for nested containers", () => {
    const source = [
      "# ATX",
      "",
      "Setext",
      "------",
      "",
      "- parent",
      "  - nested",
      "",
      "1) ordered",
      "",
      "> quote",
      "",
      "_italic_ __bold__ ~~strike~~",
    ].join("\n");
    const projection = buildEditableProjection(source);

    expect(() => projection.doc.check()).not.toThrow();
    expect(
      projection.sourceMap.wrappers.map((wrapper) => wrapper.kind),
    ).toEqual(expect.arrayContaining(["em", "strong", "strike"]));
  });

  it("keeps ZWJ and combining sequences on UTF-16 source boundaries", () => {
    const source = "A 👨‍👩‍👧‍👦 e\u0301";
    const projection = buildEditableProjection(source);
    const mapped = projection.sourceMap.segments.find(
      (segment) => segment.policy === "editable",
    )!;

    expect(mapped.text).toBe(source);
    expect(mapped.sourceOffsets).toEqual(
      Array.from({ length: source.length + 1 }, (_, index) => index),
    );
  });
});
