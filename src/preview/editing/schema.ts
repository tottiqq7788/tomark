import {
  Schema,
  type DOMOutputSpec,
  type MarkSpec,
  type NodeSpec,
} from "prosemirror-model";
import { isSafeLinkHref } from "@/shared/previewFormatting";

function sourceAttrs(sourceId: unknown): Record<string, string> {
  return typeof sourceId === "string" && sourceId
    ? { "data-tm-source-block": sourceId }
    : {};
}

const textBlockAttrs = {
  sourceId: { default: null as string | null },
};

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: "block+",
  },
  paragraph: {
    attrs: textBlockAttrs,
    content: "inline*",
    group: "block",
    toDOM: (node): DOMOutputSpec => [
      "p",
      sourceAttrs(node.attrs.sourceId),
      0,
    ],
  },
  heading: {
    attrs: {
      ...textBlockAttrs,
      level: { default: 1 },
    },
    content: "inline*",
    group: "block",
    defining: true,
    toDOM: (node): DOMOutputSpec => {
      const level = Math.max(1, Math.min(6, Number(node.attrs.level) || 1));
      return [`h${level}`, sourceAttrs(node.attrs.sourceId), 0];
    },
  },
  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    toDOM: (): DOMOutputSpec => ["blockquote", 0],
  },
  bullet_list: {
    attrs: {
      marker: { default: "-" },
    },
    content: "list_item+",
    group: "block",
    toDOM: (node): DOMOutputSpec => [
      "ul",
      { "data-tm-list-marker": String(node.attrs.marker || "-") },
      0,
    ],
  },
  ordered_list: {
    attrs: {
      order: { default: 1 },
      delimiter: { default: "." },
    },
    content: "list_item+",
    group: "block",
    toDOM: (node): DOMOutputSpec => [
      "ol",
      {
        start: Number(node.attrs.order) || 1,
        "data-tm-list-delimiter": String(node.attrs.delimiter || "."),
      },
      0,
    ],
  },
  list_item: {
    content: "paragraph block*",
    defining: true,
    toDOM: (): DOMOutputSpec => ["li", 0],
  },
  table: {
    content: "table_row+",
    group: "block",
    isolating: true,
    tableRole: "table",
    toDOM: (): DOMOutputSpec => [
      "table",
      ["tbody", 0],
    ],
  },
  table_row: {
    content: "(table_cell | table_header)+",
    tableRole: "row",
    toDOM: (): DOMOutputSpec => ["tr", 0],
  },
  table_cell: {
    attrs: {
      ...textBlockAttrs,
      align: { default: null as string | null },
    },
    content: "paragraph",
    isolating: true,
    tableRole: "cell",
    toDOM: (node): DOMOutputSpec => [
      "td",
      {
        ...sourceAttrs(node.attrs.sourceId),
        ...(typeof node.attrs.align === "string"
          ? { "data-align": node.attrs.align }
          : {}),
      },
      0,
    ],
  },
  table_header: {
    attrs: {
      ...textBlockAttrs,
      align: { default: null as string | null },
    },
    content: "paragraph",
    isolating: true,
    tableRole: "header_cell",
    toDOM: (node): DOMOutputSpec => [
      "th",
      {
        ...sourceAttrs(node.attrs.sourceId),
        ...(typeof node.attrs.align === "string"
          ? { "data-align": node.attrs.align }
          : {}),
      },
      0,
    ],
  },
  readonly_block: {
    attrs: {
      kind: { default: "unsupported" },
      label: { default: "" },
      /** Mermaid fence body (and similar); empty for ordinary readonly atoms. */
      code: { default: "" },
      sourceFrom: { default: 0 },
      sourceTo: { default: 0 },
      reason: { default: "read-only" },
    },
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,
    toDOM: (node): DOMOutputSpec => [
      "div",
      {
        class: `tm-readonly tm-readonly-block tm-readonly-${String(node.attrs.kind)}`,
        contenteditable: "false",
        "data-tm-readonly": String(node.attrs.reason),
        "data-tm-from": String(node.attrs.sourceFrom),
        "data-tm-to": String(node.attrs.sourceTo),
        role: "note",
      },
      String(node.attrs.label),
    ],
  },
  thematic_break: {
    attrs: {
      sourceFrom: { default: 0 },
      sourceTo: { default: 0 },
      reason: { default: "thematicBreak-read-only" },
    },
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,
    toDOM: (node): DOMOutputSpec => [
      "hr",
      {
        contenteditable: "false",
        "data-tm-readonly": String(node.attrs.reason),
        "data-tm-from": String(node.attrs.sourceFrom),
        "data-tm-to": String(node.attrs.sourceTo),
      },
    ],
  },
  text: {
    group: "inline",
  },
  readonly_inline: {
    attrs: {
      kind: { default: "unsupported" },
      label: { default: "" },
      src: { default: null as string | null },
      alt: { default: null as string | null },
      title: { default: null as string | null },
      sourceFrom: { default: 0 },
      sourceTo: { default: 0 },
      reason: { default: "read-only" },
    },
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,
    toDOM: (node): DOMOutputSpec => [
      "span",
      {
        class: `tm-readonly tm-readonly-inline tm-readonly-${String(node.attrs.kind)}`,
        contenteditable: "false",
        "data-tm-readonly": String(node.attrs.reason),
        "data-tm-from": String(node.attrs.sourceFrom),
        "data-tm-to": String(node.attrs.sourceTo),
        ...(typeof node.attrs.src === "string" && node.attrs.src
          ? { "data-tm-image-src": String(node.attrs.src) }
          : {}),
        role: "note",
      },
      String(node.attrs.label),
    ],
  },
  hard_break: {
    attrs: {
      sourceFrom: { default: 0 },
      sourceTo: { default: 0 },
    },
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    toDOM: (node): DOMOutputSpec => [
      "br",
      {
        contenteditable: "false",
        "data-tm-readonly": "hard-break",
        "data-tm-from": String(node.attrs.sourceFrom),
        "data-tm-to": String(node.attrs.sourceTo),
      },
    ],
  },
};

const marks: Record<string, MarkSpec> = {
  strong: {
    toDOM: (): DOMOutputSpec => ["strong", 0],
  },
  em: {
    toDOM: (): DOMOutputSpec => ["em", 0],
  },
  strike: {
    toDOM: (): DOMOutputSpec => ["del", 0],
  },
  link: {
    attrs: {
      href: { default: "" },
      title: { default: null as string | null },
    },
    inclusive: false,
    toDOM: (mark): DOMOutputSpec => {
      const href = String(mark.attrs.href || "");
      const title =
        typeof mark.attrs.title === "string" ? mark.attrs.title : undefined;
      return [
        "a",
        {
          ...(isSafeLinkHref(href) ? { href } : {}),
          ...(title ? { title } : {}),
          rel: "noopener noreferrer",
        },
        0,
      ];
    },
  },
};

/**
 * Minimal semantic schema for the source-backed editable preview.
 *
 * It intentionally has no history or Markdown serializer. Unsupported and
 * unsafe content is represented by atom nodes rendered through DOMOutputSpec.
 */
export const editablePreviewSchema = new Schema({ nodes, marks });

/*
 * `NodeType.isLeaf` is an identity comparison against ContentMatch.empty.
 * During Vite dependency re-optimization / HMR, a schema can otherwise retain
 * an equivalent empty matcher from another optimized module instance.
 * ProseMirror then treats leaf text/atom nodes as size-2 containers, shifting
 * every DOM caret after an inline atom (the task checkbox exposed this as a
 * two-character drift). Materialize the schema invariant on each leaf type so
 * it no longer depends on cross-module singleton identity.
 */
for (const type of Object.values(editablePreviewSchema.nodes)) {
  if (!type.spec.content) {
    type.inlineContent = false;
    Object.defineProperty(type, "isLeaf", {
      configurable: false,
      enumerable: false,
      value: true,
    });
  }
}

