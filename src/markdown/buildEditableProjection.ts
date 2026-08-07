import { decodeNamedCharacterReference } from "decode-named-character-reference";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import type { Point, Position } from "unist";
import {
  parseMarkdownDocument,
  type ParsedMarkdownDocument,
} from "./parseMarkdownDocument";
import { editablePreviewSchema } from "@/preview/editing/schema";

export type ProjectionPolicy = "editable" | "read-only";
export type ProjectionTextContext = "text" | "link-label" | "table-cell";

export type ImmutableRangeKind =
  | "format-delimiter"
  | "link-label-delimiter"
  | "link-destination"
  | "task-marker"
  | "read-only"
  | "block-syntax"
  | "block-boundary";

export interface ProjectionSourceSegment {
  readonly id: string;
  readonly blockId: string;
  readonly nodeType: string;
  readonly pmFrom: number;
  readonly pmTo: number;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly sourceText: string;
  readonly text: string;
  /**
   * Source offset for every PM/UTF-16 boundary in this segment.
   * Escapes and one-code-unit entities can therefore map to wider source spans.
   */
  readonly sourceOffsets: readonly number[];
  readonly sourceLine: number;
  readonly sourceEndLine: number;
  readonly policy: ProjectionPolicy;
  readonly context: ProjectionTextContext;
  readonly marks: readonly string[];
  readonly readOnlyReason?: string;
}

export interface ProjectionImmutableRange {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly kind: ImmutableRangeKind;
  readonly blockId?: string;
}

export type ProjectionWrapperKind = "strong" | "em" | "strike" | "link";

export interface ProjectionWrapper {
  readonly id: string;
  readonly blockId: string;
  readonly kind: ProjectionWrapperKind;
  readonly pmFrom: number;
  readonly pmTo: number;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly contentSourceFrom: number;
  readonly contentSourceTo: number;
  readonly immutableRanges: readonly ProjectionImmutableRange[];
}

export interface ProjectionListContext {
  readonly ordered: boolean;
  readonly marker: string;
  readonly delimiter: "." | ")" | null;
  readonly indentation: string;
  readonly taskChecked: boolean | null;
}

export interface ProjectionHeadingContext {
  readonly level: number;
  readonly style: "atx" | "setext";
  readonly marker: string;
}

export interface ProjectionTableCellContext {
  readonly row: number;
  readonly column: number;
  readonly header: boolean;
  readonly align: "left" | "right" | "center" | null;
}

export interface ProjectionBlockContext {
  readonly linePrefix: string;
  readonly quoteDepth: number;
  readonly heading?: ProjectionHeadingContext;
  readonly listItem?: ProjectionListContext;
  readonly tableCell?: ProjectionTableCellContext;
}

export interface ProjectionBlock {
  readonly id: string;
  readonly nodeType: string;
  readonly pmFrom: number;
  readonly pmTo: number;
  readonly contentPmFrom: number;
  readonly contentPmTo: number;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly contentSourceFrom: number;
  readonly contentSourceTo: number;
  readonly sourceLine: number;
  readonly sourceEndLine: number;
  readonly policy: ProjectionPolicy;
  readonly context: ProjectionBlockContext;
}

export interface MappedSourceSlice {
  readonly blockId: string;
  readonly segmentId: string;
  readonly pmFrom: number;
  readonly pmTo: number;
  readonly sourceFrom: number;
  readonly sourceTo: number;
  readonly expectedText: string;
  readonly context: ProjectionTextContext;
  readonly marks: readonly string[];
}

export type ProjectionMapFailureReason =
  | "invalid-pm-range"
  | "unmapped-position"
  | "read-only"
  | "structural-boundary";

export type ProjectionRangeResolution =
  | {
      readonly ok: true;
      readonly slices: readonly MappedSourceSlice[];
      readonly blockIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: ProjectionMapFailureReason;
      readonly pmFrom: number;
      readonly pmTo: number;
      readonly segment?: ProjectionSourceSegment;
    };

interface MdNode {
  readonly type: string;
  readonly position?: Position;
  readonly children?: readonly MdNode[];
  readonly value?: string;
  readonly depth?: number;
  readonly ordered?: boolean;
  readonly start?: number | null;
  readonly checked?: boolean | null;
  readonly url?: string;
  readonly title?: string | null;
  readonly alt?: string | null;
  readonly lang?: string | null;
  readonly align?: readonly (string | null)[];
}

interface RelativeBuild {
  readonly node: ProseMirrorNode;
  readonly segments: ProjectionSourceSegment[];
  readonly wrappers: ProjectionWrapper[];
  readonly blocks: ProjectionBlock[];
  readonly immutable: ProjectionImmutableRange[];
}

interface InlineBuild {
  readonly nodes: ProseMirrorNode[];
  readonly segments: ProjectionSourceSegment[];
  readonly wrappers: ProjectionWrapper[];
  readonly immutable: ProjectionImmutableRange[];
}

interface BuildContext {
  readonly quoteDepth: number;
  readonly listItem?: ProjectionListContext;
  readonly tableCell?: ProjectionTableCellContext;
  readonly taskMarker?: {
    readonly from: number;
    readonly to: number;
    readonly checked: boolean;
  };
}

interface MappedUnit {
  readonly text: string;
  readonly sourceFrom: number;
  readonly sourceTo: number;
}

interface RawLine {
  readonly content: string;
  readonly contentFrom: number;
  readonly endingFrom: number;
  readonly endingTo: number;
}

interface ProjectionBuildState {
  readonly source: string;
  readonly lineStarts: readonly number[];
  segmentCounter: number;
  blockCounter: number;
  wrapperCounter: number;
}

function pointOffset(point: Point | undefined): number | null {
  return point?.offset != null && Number.isSafeInteger(point.offset)
    ? point.offset
    : null;
}

function nodeRange(node: MdNode): { from: number; to: number } | null {
  const from = pointOffset(node.position?.start);
  const to = pointOffset(node.position?.end);
  return from != null && to != null && from >= 0 && to >= from
    ? { from, to }
    : null;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineAtOffset(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.max(1, low);
}

function lineStartAt(source: string, offset: number): number {
  const previous = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return previous < 0 ? 0 : previous + 1;
}

function linePrefixAt(source: string, offset: number): string {
  return source.slice(lineStartAt(source, offset), offset);
}

function shiftSegment(
  segment: ProjectionSourceSegment,
  amount: number,
): ProjectionSourceSegment {
  return {
    ...segment,
    pmFrom: segment.pmFrom + amount,
    pmTo: segment.pmTo + amount,
  };
}

function shiftWrapper(
  wrapper: ProjectionWrapper,
  amount: number,
): ProjectionWrapper {
  return {
    ...wrapper,
    pmFrom: wrapper.pmFrom + amount,
    pmTo: wrapper.pmTo + amount,
  };
}

function shiftBlock(block: ProjectionBlock, amount: number): ProjectionBlock {
  return {
    ...block,
    pmFrom: block.pmFrom + amount,
    pmTo: block.pmTo + amount,
    contentPmFrom: block.contentPmFrom + amount,
    contentPmTo: block.contentPmTo + amount,
  };
}

function splitRawLines(raw: string, absoluteFrom: number): RawLine[] {
  const lines: RawLine[] = [];
  let cursor = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    const char = raw[index];
    if (char !== "\n" && char !== "\r" && index !== raw.length) {
      continue;
    }
    const contentEnd = index;
    let endingEnd = index;
    if (index < raw.length) {
      endingEnd =
        char === "\r" && raw[index + 1] === "\n" ? index + 2 : index + 1;
    }
    lines.push({
      content: raw.slice(cursor, contentEnd),
      contentFrom: absoluteFrom + cursor,
      endingFrom: absoluteFrom + contentEnd,
      endingTo: absoluteFrom + endingEnd,
    });
    cursor = endingEnd;
    if (char === "\r" && raw[index + 1] === "\n") {
      index += 1;
    }
  }
  return lines;
}

function decodeRawLine(
  raw: string,
  absoluteFrom: number,
): { text: string; units: MappedUnit[] } | null {
  const units: MappedUnit[] = [];
  let text = "";
  let index = 0;
  while (index < raw.length) {
    const char = raw[index]!;
    if (
      char === "\\" &&
      index + 1 < raw.length &&
      /[!-/:-@[-`{-~]/.test(raw[index + 1]!)
    ) {
      const decoded = raw[index + 1]!;
      units.push({
        text: decoded,
        sourceFrom: absoluteFrom + index,
        sourceTo: absoluteFrom + index + 2,
      });
      text += decoded;
      index += 2;
      continue;
    }
    if (char === "&") {
      const match =
        /^&(#(?:[xX][0-9A-Fa-f]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/.exec(
          raw.slice(index),
        );
      if (match) {
        const decoded = decodeNamedCharacterReference(match[1]!);
        if (decoded !== false) {
          // A PM offset can split UTF-16. Multi-unit entity output has no
          // unique source boundary for such a split, so fail this whole leaf.
          if (decoded.length !== 1) {
            return null;
          }
          units.push({
            text: decoded,
            sourceFrom: absoluteFrom + index,
            sourceTo: absoluteFrom + index + match[0].length,
          });
          text += decoded;
          index += match[0].length;
          continue;
        }
      }
    }
    units.push({
      text: char,
      sourceFrom: absoluteFrom + index,
      sourceTo: absoluteFrom + index + 1,
    });
    text += char;
    index += 1;
  }
  return { text, units };
}

function mapTextUnits(
  source: string,
  node: MdNode,
): MappedUnit[] | null {
  const range = nodeRange(node);
  const value = node.value;
  if (!range || typeof value !== "string") {
    return null;
  }
  const rawLines = splitRawLines(source.slice(range.from, range.to), range.from);
  const visibleLines = value.split("\n");
  if (rawLines.length !== visibleLines.length) {
    return null;
  }

  const units: MappedUnit[] = [];
  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const rawLine = rawLines[lineIndex]!;
    const visibleLine = visibleLines[lineIndex]!;
    const candidateStarts: number[] = [];
    if (lineIndex === 0) {
      candidateStarts.push(0);
    } else {
      let prefixEnd = 0;
      while (
        prefixEnd < rawLine.content.length &&
        /[ \t>]/.test(rawLine.content[prefixEnd]!)
      ) {
        prefixEnd += 1;
      }
      // Pathological indentation is safer as a read-only leaf than an
      // accidental quadratic alignment.
      if (prefixEnd > 256) {
        return null;
      }
      for (let start = 0; start <= prefixEnd; start += 1) {
        candidateStarts.push(start);
      }
    }

    const matches: { start: number; units: MappedUnit[] }[] = [];
    for (const start of candidateStarts) {
      const decoded = decodeRawLine(
        rawLine.content.slice(start),
        rawLine.contentFrom + start,
      );
      if (decoded?.text === visibleLine) {
        matches.push({ start, units: decoded.units });
      }
    }
    if (matches.length !== 1) {
      return null;
    }
    units.push(...matches[0]!.units);
    if (lineIndex < rawLines.length - 1) {
      if (rawLine.endingTo <= rawLine.endingFrom) {
        return null;
      }
      units.push({
        text: "\n",
        sourceFrom: rawLine.endingFrom,
        sourceTo: rawLine.endingTo,
      });
    }
  }
  return units.length === value.length ? units : null;
}

function marksToNames(marks: readonly Mark[]): string[] {
  return marks.map((mark) => mark.type.name);
}

function readonlyLabel(node: MdNode): string {
  switch (node.type) {
    case "image":
      return node.alt ? `图片：${node.alt}` : "图片";
    case "inlineCode":
      return node.value ?? "行内代码";
    case "code":
      return node.lang?.toLowerCase() === "mermaid"
        ? "Mermaid 图表（只读）"
        : node.value || "代码块（只读）";
    case "html":
      return "HTML（只读）";
    case "thematicBreak":
      return "分隔线";
    case "break":
      return "换行";
    case "footnoteReference":
    case "footnoteDefinition":
      return "脚注（只读）";
    default:
      return node.value || "暂不支持的 Markdown（只读）";
  }
}

function makeReadonlyInline(
  state: ProjectionBuildState,
  node: MdNode,
  blockId: string,
  context: ProjectionTextContext,
  marks: readonly Mark[],
  reason: string,
  kind = node.type,
  label = readonlyLabel(node),
): InlineBuild {
  const range = nodeRange(node) ?? { from: 0, to: 0 };
  const atom = editablePreviewSchema.nodes.readonly_inline
    .create({
      kind,
      label,
      sourceFrom: range.from,
      sourceTo: range.to,
      reason,
    })
    .mark(marks);
  const segment: ProjectionSourceSegment = {
    id: `segment-${++state.segmentCounter}`,
    blockId,
    nodeType: node.type,
    pmFrom: 0,
    pmTo: atom.nodeSize,
    sourceFrom: range.from,
    sourceTo: range.to,
    sourceText: state.source.slice(range.from, range.to),
    text: label,
    sourceOffsets: [range.from, range.to],
    sourceLine: lineAtOffset(state.lineStarts, range.from),
    sourceEndLine: lineAtOffset(state.lineStarts, range.to),
    policy: "read-only",
    context,
    marks: marksToNames(marks),
    readOnlyReason: reason,
  };
  return {
    nodes: [atom],
    segments: [segment],
    wrappers: [],
    immutable: [
      {
        from: range.from,
        to: range.to,
        text: state.source.slice(range.from, range.to),
        kind: "read-only",
        blockId,
      },
    ],
  };
}

function makeMappedText(
  state: ProjectionBuildState,
  node: MdNode,
  blockId: string,
  context: ProjectionTextContext,
  marks: readonly Mark[],
): InlineBuild {
  const value = node.value ?? "";
  if (!value) {
    return { nodes: [], segments: [], wrappers: [], immutable: [] };
  }
  const units = mapTextUnits(state.source, node);
  if (!units) {
    return makeReadonlyInline(
      state,
      node,
      blockId,
      context,
      marks,
      "ambiguous-source-map",
      "unmapped-text",
      value,
    );
  }

  const textNode = editablePreviewSchema.text(value, marks);
  const segments: ProjectionSourceSegment[] = [];
  let groupStart = 0;
  for (let index = 1; index <= units.length; index += 1) {
    const previous = units[index - 1]!;
    const current = units[index];
    if (current && current.sourceFrom === previous.sourceTo) {
      continue;
    }
    const group = units.slice(groupStart, index);
    const sourceFrom = group[0]!.sourceFrom;
    const sourceTo = group[group.length - 1]!.sourceTo;
    const text = group.map((unit) => unit.text).join("");
    segments.push({
      id: `segment-${++state.segmentCounter}`,
      blockId,
      nodeType: node.type,
      pmFrom: groupStart,
      pmTo: index,
      sourceFrom,
      sourceTo,
      sourceText: state.source.slice(sourceFrom, sourceTo),
      text,
      sourceOffsets: [sourceFrom, ...group.map((unit) => unit.sourceTo)],
      sourceLine: lineAtOffset(state.lineStarts, sourceFrom),
      sourceEndLine: lineAtOffset(state.lineStarts, sourceTo),
      policy: "editable",
      context,
      marks: marksToNames(marks),
    });
    groupStart = index;
  }

  return {
    nodes: [textNode],
    segments,
    wrappers: [],
    immutable: [],
  };
}

function appendInline(target: InlineBuild, child: InlineBuild): InlineBuild {
  const offset = target.nodes.reduce((size, node) => size + node.nodeSize, 0);
  return {
    nodes: [...target.nodes, ...child.nodes],
    segments: [
      ...target.segments,
      ...child.segments.map((segment) => shiftSegment(segment, offset)),
    ],
    wrappers: [
      ...target.wrappers,
      ...child.wrappers.map((wrapper) => shiftWrapper(wrapper, offset)),
    ],
    immutable: [...target.immutable, ...child.immutable],
  };
}

function childSourceBounds(
  children: readonly MdNode[],
  fallback: { from: number; to: number },
): { from: number; to: number } {
  const ranges = children
    .map(nodeRange)
    .filter((range): range is { from: number; to: number } => range != null);
  return ranges.length
    ? {
        from: Math.min(...ranges.map((range) => range.from)),
        to: Math.max(...ranges.map((range) => range.to)),
      }
    : fallback;
}

function buildMarkedInline(
  state: ProjectionBuildState,
  node: MdNode,
  blockId: string,
  context: ProjectionTextContext,
  marks: readonly Mark[],
  kind: Exclude<ProjectionWrapperKind, "link">,
): InlineBuild {
  const mark = editablePreviewSchema.marks[kind].create();
  const children = node.children ?? [];
  const built = buildInlineChildren(
    state,
    children,
    blockId,
    context,
    [...marks, mark],
  );
  const range = nodeRange(node);
  if (!range || built.nodes.length === 0) {
    return makeReadonlyInline(
      state,
      node,
      blockId,
      context,
      marks,
      "empty-or-unmapped-wrapper",
      kind,
      readonlyLabel(node),
    );
  }
  const childBounds = childSourceBounds(children, range);
  const immutable = ([
    {
      from: range.from,
      to: childBounds.from,
      text: state.source.slice(range.from, childBounds.from),
      kind: "format-delimiter",
      blockId,
    },
    {
      from: childBounds.to,
      to: range.to,
      text: state.source.slice(childBounds.to, range.to),
      kind: "format-delimiter",
      blockId,
    },
  ] satisfies ProjectionImmutableRange[]).filter((item) => item.to > item.from);
  const wrapper: ProjectionWrapper = {
    id: `wrapper-${++state.wrapperCounter}`,
    blockId,
    kind,
    pmFrom: 0,
    pmTo: built.nodes.reduce((size, child) => size + child.nodeSize, 0),
    sourceFrom: range.from,
    sourceTo: range.to,
    contentSourceFrom: childBounds.from,
    contentSourceTo: childBounds.to,
    immutableRanges: immutable,
  };
  return {
    ...built,
    wrappers: [...built.wrappers, wrapper],
    immutable: [...built.immutable, ...immutable],
  };
}

function isExplicitLink(state: ProjectionBuildState, node: MdNode): boolean {
  const range = nodeRange(node);
  return !!range && state.source[range.from] === "[";
}

function buildLinkInline(
  state: ProjectionBuildState,
  node: MdNode,
  blockId: string,
  marks: readonly Mark[],
): InlineBuild {
  if (!isExplicitLink(state, node) || !node.children?.length) {
    const label =
      node.children
        ?.map((child) => child.value ?? "")
        .join("") ||
      node.url ||
      "链接";
    return makeReadonlyInline(
      state,
      node,
      blockId,
      "text",
      marks,
      "automatic-or-reference-link",
      "link",
      label,
    );
  }

  const linkMark = editablePreviewSchema.marks.link.create({
    href: node.url ?? "",
    title: node.title ?? null,
  });
  const built = buildInlineChildren(
    state,
    node.children,
    blockId,
    "link-label",
    [...marks, linkMark],
  );
  const range = nodeRange(node);
  if (!range || built.nodes.length === 0) {
    return makeReadonlyInline(
      state,
      node,
      blockId,
      "link-label",
      marks,
      "empty-or-unmapped-link",
      "link",
      "链接",
    );
  }
  const childBounds = childSourceBounds(node.children, range);
  const immutable = ([
    {
      from: range.from,
      to: childBounds.from,
      text: state.source.slice(range.from, childBounds.from),
      kind: "link-label-delimiter",
      blockId,
    },
    {
      from: childBounds.to,
      to: range.to,
      text: state.source.slice(childBounds.to, range.to),
      kind: "link-destination",
      blockId,
    },
  ] satisfies ProjectionImmutableRange[]).filter((item) => item.to > item.from);
  const wrapper: ProjectionWrapper = {
    id: `wrapper-${++state.wrapperCounter}`,
    blockId,
    kind: "link",
    pmFrom: 0,
    pmTo: built.nodes.reduce((size, child) => size + child.nodeSize, 0),
    sourceFrom: range.from,
    sourceTo: range.to,
    contentSourceFrom: childBounds.from,
    contentSourceTo: childBounds.to,
    immutableRanges: immutable,
  };
  return {
    ...built,
    wrappers: [...built.wrappers, wrapper],
    immutable: [...built.immutable, ...immutable],
  };
}

function buildInlineNode(
  state: ProjectionBuildState,
  node: MdNode,
  blockId: string,
  context: ProjectionTextContext,
  marks: readonly Mark[],
): InlineBuild {
  switch (node.type) {
    case "text":
      return makeMappedText(state, node, blockId, context, marks);
    case "strong":
      return buildMarkedInline(
        state,
        node,
        blockId,
        context,
        marks,
        "strong",
      );
    case "emphasis":
      return buildMarkedInline(state, node, blockId, context, marks, "em");
    case "delete":
      return buildMarkedInline(state, node, blockId, context, marks, "strike");
    case "link":
      return buildLinkInline(state, node, blockId, marks);
    case "break": {
      const range = nodeRange(node) ?? { from: 0, to: 0 };
      const hardBreak = editablePreviewSchema.nodes.hard_break
        .create({ sourceFrom: range.from, sourceTo: range.to })
        .mark(marks);
      return {
        nodes: [hardBreak],
        segments: [
          {
            id: `segment-${++state.segmentCounter}`,
            blockId,
            nodeType: node.type,
            pmFrom: 0,
            pmTo: hardBreak.nodeSize,
            sourceFrom: range.from,
            sourceTo: range.to,
            sourceText: state.source.slice(range.from, range.to),
            text: "\n",
            sourceOffsets: [range.from, range.to],
            sourceLine: lineAtOffset(state.lineStarts, range.from),
            sourceEndLine: lineAtOffset(state.lineStarts, range.to),
            policy: "read-only",
            context,
            marks: marksToNames(marks),
            readOnlyReason: "hard-break",
          },
        ],
        wrappers: [],
        immutable: [
          {
            from: range.from,
            to: range.to,
            text: state.source.slice(range.from, range.to),
            kind: "read-only",
            blockId,
          },
        ],
      };
    }
    case "inlineCode":
    case "image":
    case "imageReference":
    case "linkReference":
    case "html":
    case "footnoteReference":
      return makeReadonlyInline(
        state,
        node,
        blockId,
        context,
        marks,
        `${node.type}-read-only`,
      );
    default:
      return makeReadonlyInline(
        state,
        node,
        blockId,
        context,
        marks,
        "unsupported-inline-node",
      );
  }
}

function buildInlineChildren(
  state: ProjectionBuildState,
  children: readonly MdNode[],
  blockId: string,
  context: ProjectionTextContext,
  marks: readonly Mark[] = [],
): InlineBuild {
  let result: InlineBuild = {
    nodes: [],
    segments: [],
    wrappers: [],
    immutable: [],
  };
  for (const child of children) {
    result = appendInline(
      result,
      buildInlineNode(state, child, blockId, context, marks),
    );
  }
  return result;
}

function headingContext(
  source: string,
  node: MdNode,
): ProjectionHeadingContext {
  const range = nodeRange(node) ?? { from: 0, to: 0 };
  const raw = source.slice(range.from, range.to);
  const atx = /^(#{1,6})(?:[ \t]+|$)/.exec(raw);
  const level = Math.max(1, Math.min(6, node.depth ?? atx?.[1]?.length ?? 1));
  if (atx) {
    return { level, style: "atx", marker: atx[1]! };
  }
  const marker = /(?:^|\r?\n)(=+|-+)[ \t]*$/.exec(raw)?.[1] ?? "-";
  return { level, style: "setext", marker };
}

function listContext(
  source: string,
  node: MdNode,
  ordered: boolean,
): ProjectionListContext {
  const range = nodeRange(node) ?? { from: 0, to: 0 };
  const end = node.children?.[0]
    ? (nodeRange(node.children[0])?.from ?? range.to)
    : range.to;
  const prefix = source.slice(lineStartAt(source, range.from), end);
  const match = /([*+-]|\d+([.)]))([ \t]+)(?:\[[ xX]\][ \t]+)?$/.exec(
    prefix,
  );
  const marker = match?.[1] ?? (ordered ? `${node.start ?? 1}.` : "-");
  return {
    ordered,
    marker,
    delimiter: ordered
      ? marker.endsWith(")")
        ? ")"
        : "."
      : null,
    indentation: match ? prefix.slice(0, match.index) : "",
    taskChecked: node.checked == null ? null : !!node.checked,
  };
}

function taskMarker(
  source: string,
  node: MdNode,
  paragraph: MdNode | undefined,
): BuildContext["taskMarker"] {
  if (node.checked == null || !paragraph) {
    return undefined;
  }
  const itemRange = nodeRange(node);
  const paragraphRange = nodeRange(paragraph);
  if (!itemRange || !paragraphRange) {
    return undefined;
  }
  const prefix = source.slice(itemRange.from, paragraphRange.from);
  const match = /\[[ xX]\][ \t]+$/.exec(prefix);
  return match
    ? {
        from: itemRange.from + match.index,
        to: paragraphRange.from,
        checked: !!node.checked,
      }
    : undefined;
}

function inferContentBounds(
  state: ProjectionBuildState,
  node: MdNode,
  inline: InlineBuild,
  context: BuildContext,
): { from: number; to: number } {
  const childRanges = (node.children ?? [])
    .map(nodeRange)
    .filter((range): range is { from: number; to: number } => range != null);
  if (childRanges.length) {
    return {
      from: Math.min(...childRanges.map((range) => range.from)),
      to: Math.max(...childRanges.map((range) => range.to)),
    };
  }
  const editable = inline.segments.filter(
    (segment) => segment.policy === "editable",
  );
  if (editable.length) {
    return {
      from: editable[0]!.sourceFrom,
      to: editable[editable.length - 1]!.sourceTo,
    };
  }
  const range = nodeRange(node) ?? { from: 0, to: 0 };
  if (node.type === "heading") {
    const raw = state.source.slice(range.from, range.to);
    const marker = /^(?:#{1,6}[ \t]+)?/.exec(raw)?.[0].length ?? 0;
    return { from: range.from + marker, to: range.from + marker };
  }
  if (context.tableCell) {
    const raw = state.source.slice(range.from, range.to);
    const left = /^\|?[ \t]*/.exec(raw)?.[0].length ?? 0;
    const right = /[ \t]*\|?$/.exec(raw)?.[0].length ?? 0;
    const at = Math.min(range.to - right, range.from + left);
    return { from: at, to: at };
  }
  return { from: range.from, to: range.from };
}

function buildTextBlock(
  state: ProjectionBuildState,
  node: MdNode,
  nodeType: "paragraph" | "heading",
  context: BuildContext,
): RelativeBuild {
  const blockId = `block-${++state.blockCounter}`;
  const textContext: ProjectionTextContext = context.tableCell
    ? "table-cell"
    : "text";
  let inline = buildInlineChildren(
    state,
    node.children ?? [],
    blockId,
    textContext,
  );

  if (context.taskMarker) {
    const task = context.taskMarker;
    const label = task.checked ? "☑" : "☐";
    const atom = editablePreviewSchema.nodes.readonly_inline.create({
      kind: "task-checkbox",
      label,
      sourceFrom: task.from,
      sourceTo: task.to,
      reason: "task-checkbox-read-only",
    });
    const taskBuild: InlineBuild = {
      nodes: [atom],
      segments: [
        {
          id: `segment-${++state.segmentCounter}`,
          blockId,
          nodeType: "task-checkbox",
          pmFrom: 0,
          pmTo: atom.nodeSize,
          sourceFrom: task.from,
          sourceTo: task.to,
          sourceText: state.source.slice(task.from, task.to),
          text: label,
          sourceOffsets: [task.from, task.to],
          sourceLine: lineAtOffset(state.lineStarts, task.from),
          sourceEndLine: lineAtOffset(state.lineStarts, task.to),
          policy: "read-only",
          context: textContext,
          marks: [],
          readOnlyReason: "task-checkbox-read-only",
        },
      ],
      wrappers: [],
      immutable: [
        {
          from: task.from,
          to: task.to,
          text: state.source.slice(task.from, task.to),
          kind: "task-marker",
          blockId,
        },
      ],
    };
    inline = appendInline(taskBuild, inline);
  }

  const heading = nodeType === "heading" ? headingContext(state.source, node) : undefined;
  const pmNode =
    nodeType === "heading"
      ? editablePreviewSchema.nodes.heading.create(
          { level: heading!.level, sourceId: blockId },
          inline.nodes,
        )
      : editablePreviewSchema.nodes.paragraph.create(
          { sourceId: blockId },
          inline.nodes,
        );
  const range = nodeRange(node) ?? { from: 0, to: 0 };
  const content = inferContentBounds(state, node, inline, context);
  const linePrefix = linePrefixAt(state.source, content.from);
  const blockSourceFrom =
    context.listItem || context.quoteDepth > 0
      ? lineStartAt(state.source, range.from)
      : range.from;
  const blockContext: ProjectionBlockContext = {
    linePrefix,
    quoteDepth: context.quoteDepth,
    ...(heading ? { heading } : {}),
    ...(context.listItem ? { listItem: context.listItem } : {}),
    ...(context.tableCell ? { tableCell: context.tableCell } : {}),
  };
  const block: ProjectionBlock = {
    id: blockId,
    nodeType: context.tableCell ? "tableCell" : node.type,
    pmFrom: 0,
    pmTo: pmNode.nodeSize,
    contentPmFrom: 1,
    contentPmTo: pmNode.nodeSize - 1,
    sourceFrom: blockSourceFrom,
    sourceTo: range.to,
    contentSourceFrom: content.from,
    contentSourceTo: content.to,
    sourceLine: lineAtOffset(state.lineStarts, blockSourceFrom),
    sourceEndLine: lineAtOffset(state.lineStarts, range.to),
    policy: "editable",
    context: blockContext,
  };
  return {
    node: pmNode,
    segments: inline.segments.map((segment) => shiftSegment(segment, 1)),
    wrappers: inline.wrappers.map((wrapper) => shiftWrapper(wrapper, 1)),
    blocks: [block],
    immutable: inline.immutable,
  };
}

function combineChildren(
  _state: ProjectionBuildState,
  type: "blockquote" | "bullet_list" | "ordered_list" | "list_item" | "table" | "table_row" | "table_cell" | "table_header",
  attrs: Record<string, unknown> | null,
  children: readonly RelativeBuild[],
): RelativeBuild {
  const nodes: ProseMirrorNode[] = [];
  const segments: ProjectionSourceSegment[] = [];
  const wrappers: ProjectionWrapper[] = [];
  const blocks: ProjectionBlock[] = [];
  const immutable: ProjectionImmutableRange[] = [];
  let contentOffset = 0;
  for (const child of children) {
    const shift = 1 + contentOffset;
    nodes.push(child.node);
    segments.push(...child.segments.map((segment) => shiftSegment(segment, shift)));
    wrappers.push(...child.wrappers.map((wrapper) => shiftWrapper(wrapper, shift)));
    blocks.push(...child.blocks.map((block) => shiftBlock(block, shift)));
    immutable.push(...child.immutable);
    contentOffset += child.node.nodeSize;
  }
  const node = editablePreviewSchema.nodes[type].create(attrs, nodes);
  return { node, segments, wrappers, blocks, immutable };
}

function syntheticEmptyNode(node: MdNode): MdNode {
  const end = node.position?.end;
  return {
    type: "paragraph",
    children: [],
    position: end
      ? {
          start: { ...end },
          end: { ...end },
        }
      : undefined,
  };
}

function syntheticListParagraph(
  state: ProjectionBuildState,
  node: MdNode,
): MdNode {
  const range = nodeRange(node);
  const start = node.position?.start;
  if (!range || !start) {
    return syntheticEmptyNode(node);
  }
  const lineEnd = state.source.indexOf("\n", range.from);
  const firstLine = state.source.slice(
    range.from,
    lineEnd < 0 ? range.to : Math.min(range.to, lineEnd),
  );
  const marker = /^(?:[*+-]|\d+[.)])(?:[ \t]+)?/.exec(firstLine)?.[0] ?? "";
  const offset = range.from + marker.length;
  const point = {
    line: start.line,
    column: start.column + marker.length,
    offset,
  };
  return {
    type: "paragraph",
    children: [],
    position: { start: point, end: { ...point } },
  };
}

function buildListItem(
  state: ProjectionBuildState,
  node: MdNode,
  context: BuildContext,
  ordered: boolean,
): RelativeBuild {
  const itemContext = listContext(state.source, node, ordered);
  const existingChildren = node.children ? [...node.children] : [];
  const mdChildren =
    existingChildren[0]?.type === "paragraph"
      ? existingChildren
      : [syntheticListParagraph(state, node), ...existingChildren];
  const firstParagraph = mdChildren[0]?.type === "paragraph" ? mdChildren[0] : undefined;
  const task = taskMarker(state.source, node, firstParagraph);
  const children = mdChildren.map((child, index) =>
    buildBlockNode(state, child, {
      ...context,
      listItem: itemContext,
      ...(index === 0 && task ? { taskMarker: task } : { taskMarker: undefined }),
    }),
  );
  return combineChildren(state, "list_item", null, children);
}

function buildList(
  state: ProjectionBuildState,
  node: MdNode,
  context: BuildContext,
): RelativeBuild {
  const ordered = !!node.ordered;
  const children = (node.children ?? []).map((child) =>
    buildListItem(state, child, context, ordered),
  );
  const firstContext = node.children?.[0]
    ? listContext(state.source, node.children[0], ordered)
    : {
        ordered,
        marker: ordered ? `${node.start ?? 1}.` : "-",
        delimiter: ordered ? ("." as const) : null,
        indentation: "",
        taskChecked: null,
      };
  return combineChildren(
    state,
    ordered ? "ordered_list" : "bullet_list",
    ordered
      ? { order: node.start ?? 1, delimiter: firstContext.delimiter ?? "." }
      : { marker: firstContext.marker },
    children,
  );
}

function buildBlockquote(
  state: ProjectionBuildState,
  node: MdNode,
  context: BuildContext,
): RelativeBuild {
  const mdChildren =
    node.children && node.children.length
      ? node.children
      : [syntheticEmptyNode(node)];
  const children = mdChildren.map((child) =>
    buildBlockNode(state, child, {
      ...context,
      quoteDepth: context.quoteDepth + 1,
    }),
  );
  return combineChildren(state, "blockquote", null, children);
}

function buildTableCell(
  state: ProjectionBuildState,
  node: MdNode,
  context: BuildContext,
  cell: ProjectionTableCellContext,
): RelativeBuild {
  const paragraph = buildTextBlock(
    state,
    { ...node, type: "tableCell" },
    "paragraph",
    { ...context, tableCell: cell },
  );
  const blockId = paragraph.blocks[0]?.id ?? null;
  return combineChildren(
    state,
    cell.header ? "table_header" : "table_cell",
    { align: cell.align, sourceId: blockId },
    [paragraph],
  );
}

function buildTable(
  state: ProjectionBuildState,
  node: MdNode,
  context: BuildContext,
): RelativeBuild {
  const rows = (node.children ?? []).map((row, rowIndex) => {
    const cells = (row.children ?? []).map((cellNode, columnIndex) =>
      buildTableCell(state, cellNode, context, {
        row: rowIndex,
        column: columnIndex,
        header: rowIndex === 0,
        align:
          node.align?.[columnIndex] === "left" ||
          node.align?.[columnIndex] === "right" ||
          node.align?.[columnIndex] === "center"
            ? node.align[columnIndex]
            : null,
      }),
    );
    return combineChildren(state, "table_row", null, cells);
  });
  return combineChildren(state, "table", null, rows);
}

function buildReadonlyBlock(
  state: ProjectionBuildState,
  node: MdNode,
  context: BuildContext,
): RelativeBuild {
  const range = nodeRange(node) ?? { from: 0, to: 0 };
  const blockId = `block-${++state.blockCounter}`;
  const label = readonlyLabel(node);
  const pmNode = editablePreviewSchema.nodes.readonly_block.create({
    kind:
      node.type === "code" && node.lang?.toLowerCase() === "mermaid"
        ? "mermaid"
        : node.type,
    label,
    sourceFrom: range.from,
    sourceTo: range.to,
    reason: `${node.type}-read-only`,
  });
  const immutable: ProjectionImmutableRange = {
    from: range.from,
    to: range.to,
    text: state.source.slice(range.from, range.to),
    kind: "read-only",
    blockId,
  };
  return {
    node: pmNode,
    segments: [
      {
        id: `segment-${++state.segmentCounter}`,
        blockId,
        nodeType: node.type,
        pmFrom: 0,
        pmTo: pmNode.nodeSize,
        sourceFrom: range.from,
        sourceTo: range.to,
        sourceText: state.source.slice(range.from, range.to),
        text: label,
        sourceOffsets: [range.from, range.to],
        sourceLine: lineAtOffset(state.lineStarts, range.from),
        sourceEndLine: lineAtOffset(state.lineStarts, range.to),
        policy: "read-only",
        context: "text",
        marks: [],
        readOnlyReason: `${node.type}-read-only`,
      },
    ],
    wrappers: [],
    blocks: [
      {
        id: blockId,
        nodeType: node.type,
        pmFrom: 0,
        pmTo: pmNode.nodeSize,
        contentPmFrom: 0,
        contentPmTo: pmNode.nodeSize,
        sourceFrom: range.from,
        sourceTo: range.to,
        contentSourceFrom: range.from,
        contentSourceTo: range.to,
        sourceLine: lineAtOffset(state.lineStarts, range.from),
        sourceEndLine: lineAtOffset(state.lineStarts, range.to),
        policy: "read-only",
        context: {
          linePrefix: linePrefixAt(state.source, range.from),
          quoteDepth: context.quoteDepth,
          ...(context.listItem ? { listItem: context.listItem } : {}),
        },
      },
    ],
    immutable: [immutable],
  };
}

function buildBlockNode(
  state: ProjectionBuildState,
  node: MdNode,
  context: BuildContext,
): RelativeBuild {
  switch (node.type) {
    case "paragraph":
      return buildTextBlock(state, node, "paragraph", context);
    case "heading":
      return buildTextBlock(state, node, "heading", context);
    case "blockquote":
      return buildBlockquote(state, node, context);
    case "list":
      return buildList(state, node, context);
    case "table":
      return buildTable(state, node, context);
    case "code":
    case "html":
    case "thematicBreak":
    case "definition":
    case "footnoteDefinition":
    case "yaml":
      return buildReadonlyBlock(state, node, context);
    default:
      return buildReadonlyBlock(state, node, context);
  }
}

function normalizeSpecificImmutable(
  source: string,
  ranges: readonly ProjectionImmutableRange[],
): ProjectionImmutableRange[] {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .slice()
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const result: ProjectionImmutableRange[] = [];
  for (const range of sorted) {
    const previous = result[result.length - 1];
    if (previous && range.from < previous.to) {
      if (range.to <= previous.to) {
        continue;
      }
      result.push({
        ...range,
        from: previous.to,
        text: source.slice(previous.to, range.to),
      });
      continue;
    }
    result.push({ ...range, text: source.slice(range.from, range.to) });
  }
  return result;
}

function buildImmutableIndex(
  source: string,
  segments: readonly ProjectionSourceSegment[],
  specific: readonly ProjectionImmutableRange[],
): ProjectionImmutableRange[] {
  const immutable = normalizeSpecificImmutable(source, specific);
  const occupied = [
    ...segments
      .filter((segment) => segment.policy === "editable")
      .map((segment) => ({ from: segment.sourceFrom, to: segment.sourceTo })),
    ...immutable.map((range) => ({ from: range.from, to: range.to })),
  ]
    .filter((range) => range.to > range.from)
    .sort((a, b) => a.from - b.from || b.to - a.to);

  const merged: { from: number; to: number }[] = [];
  for (const range of occupied) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }

  let cursor = 0;
  const gaps: ProjectionImmutableRange[] = [];
  for (const range of merged) {
    if (range.from > cursor) {
      const text = source.slice(cursor, range.from);
      gaps.push({
        from: cursor,
        to: range.from,
        text,
        kind: /^[\s]*$/.test(text) ? "block-boundary" : "block-syntax",
      });
    }
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < source.length) {
    const text = source.slice(cursor);
    gaps.push({
      from: cursor,
      to: source.length,
      text,
      kind: /^[\s]*$/.test(text) ? "block-boundary" : "block-syntax",
    });
  }
  return [...immutable, ...gaps].sort((a, b) => a.from - b.from || a.to - b.to);
}

export class EditableSourceMap {
  readonly source: string;
  readonly segments: readonly ProjectionSourceSegment[];
  readonly blocks: readonly ProjectionBlock[];
  readonly wrappers: readonly ProjectionWrapper[];
  readonly immutableRanges: readonly ProjectionImmutableRange[];

  constructor(options: {
    source: string;
    segments: readonly ProjectionSourceSegment[];
    blocks: readonly ProjectionBlock[];
    wrappers: readonly ProjectionWrapper[];
    immutableRanges: readonly ProjectionImmutableRange[];
  }) {
    this.source = options.source;
    this.segments = options.segments.slice().sort((a, b) => a.pmFrom - b.pmFrom);
    this.blocks = options.blocks.slice().sort((a, b) => a.pmFrom - b.pmFrom);
    this.wrappers = options.wrappers
      .slice()
      .sort((a, b) => a.pmFrom - b.pmFrom || b.pmTo - a.pmTo);
    this.immutableRanges = options.immutableRanges;
  }

  blockAt(position: number): ProjectionBlock | null {
    const matches = this.blocks.filter(
      (block) => position >= block.pmFrom && position <= block.pmTo,
    );
    return (
      matches.sort(
        (a, b) => a.pmTo - a.pmFrom - (b.pmTo - b.pmFrom),
      )[0] ?? null
    );
  }

  mapPmPosition(
    position: number,
    association: -1 | 1 = 1,
  ): { sourceOffset: number; segment: ProjectionSourceSegment } | null {
    const candidates = this.segments.filter(
      (segment) =>
        segment.policy === "editable" &&
        position >= segment.pmFrom &&
        position <= segment.pmTo,
    );
    candidates.sort((a, b) =>
      association > 0 ? b.pmFrom - a.pmFrom : a.pmTo - b.pmTo,
    );
    const segment = candidates[0];
    if (segment) {
      const local = position - segment.pmFrom;
      const sourceOffset = segment.sourceOffsets[local];
      return sourceOffset == null ? null : { sourceOffset, segment };
    }

    const block = this.blockAt(position);
    if (
      block?.policy === "editable" &&
      position >= block.contentPmFrom &&
      position <= block.contentPmTo &&
      block.contentPmFrom === block.contentPmTo
    ) {
      const synthetic: ProjectionSourceSegment = {
        id: `${block.id}-empty`,
        blockId: block.id,
        nodeType: block.nodeType,
        pmFrom: position,
        pmTo: position,
        sourceFrom: block.contentSourceFrom,
        sourceTo: block.contentSourceFrom,
        sourceText: "",
        text: "",
        sourceOffsets: [block.contentSourceFrom],
        sourceLine: block.sourceLine,
        sourceEndLine: block.sourceEndLine,
        policy: "editable",
        context: block.context.tableCell ? "table-cell" : "text",
        marks: [],
      };
      return { sourceOffset: block.contentSourceFrom, segment: synthetic };
    }
    return null;
  }

  resolveEditableRange(
    pmFrom: number,
    pmTo: number,
  ): ProjectionRangeResolution {
    if (
      !Number.isSafeInteger(pmFrom) ||
      !Number.isSafeInteger(pmTo) ||
      pmFrom < 0 ||
      pmTo < pmFrom
    ) {
      return { ok: false, reason: "invalid-pm-range", pmFrom, pmTo };
    }
    if (pmFrom === pmTo) {
      const mapped = this.mapPmPosition(pmFrom, 1);
      if (!mapped) {
        const readonly = this.segments.find(
          (segment) =>
            segment.policy === "read-only" &&
            pmFrom >= segment.pmFrom &&
            pmFrom <= segment.pmTo,
        );
        return {
          ok: false,
          reason: readonly ? "read-only" : "unmapped-position",
          pmFrom,
          pmTo,
          ...(readonly ? { segment: readonly } : {}),
        };
      }
      return {
        ok: true,
        slices: [
          {
            blockId: mapped.segment.blockId,
            segmentId: mapped.segment.id,
            pmFrom,
            pmTo,
            sourceFrom: mapped.sourceOffset,
            sourceTo: mapped.sourceOffset,
            expectedText: "",
            context: mapped.segment.context,
            marks: mapped.segment.marks,
          },
        ],
        blockIds: [mapped.segment.blockId],
      };
    }

    const touched = this.segments
      .filter((segment) => segment.pmTo > pmFrom && segment.pmFrom < pmTo)
      .sort((a, b) => a.pmFrom - b.pmFrom);
    const readonly = touched.find((segment) => segment.policy === "read-only");
    if (readonly) {
      return {
        ok: false,
        reason: "read-only",
        pmFrom,
        pmTo,
        segment: readonly,
      };
    }

    let cursor = pmFrom;
    const slices: MappedSourceSlice[] = [];
    for (const segment of touched) {
      const from = Math.max(pmFrom, segment.pmFrom);
      const to = Math.min(pmTo, segment.pmTo);
      if (from > cursor) {
        return { ok: false, reason: "structural-boundary", pmFrom, pmTo };
      }
      const localFrom = from - segment.pmFrom;
      const localTo = to - segment.pmFrom;
      const sourceFrom = segment.sourceOffsets[localFrom];
      const sourceTo = segment.sourceOffsets[localTo];
      if (sourceFrom == null || sourceTo == null) {
        return { ok: false, reason: "unmapped-position", pmFrom, pmTo };
      }
      slices.push({
        blockId: segment.blockId,
        segmentId: segment.id,
        pmFrom: from,
        pmTo: to,
        sourceFrom,
        sourceTo,
        expectedText: this.source.slice(sourceFrom, sourceTo),
        context: segment.context,
        marks: segment.marks,
      });
      cursor = Math.max(cursor, to);
    }
    if (cursor < pmTo || slices.length === 0) {
      return { ok: false, reason: "structural-boundary", pmFrom, pmTo };
    }
    return {
      ok: true,
      slices,
      blockIds: [...new Set(slices.map((slice) => slice.blockId))],
    };
  }
}

export interface EditableProjection {
  readonly parsed: ParsedMarkdownDocument;
  readonly doc: ProseMirrorNode;
  readonly sourceMap: EditableSourceMap;
}

/**
 * Build a semantic PM document and a separate, fail-closed source map.
 * No Markdown is serialized by this module.
 */
export function buildEditableProjection(
  input: string | ParsedMarkdownDocument,
): EditableProjection {
  const parsed =
    typeof input === "string" ? parseMarkdownDocument(input) : input;
  const state: ProjectionBuildState = {
    source: parsed.source,
    lineStarts: lineStarts(parsed.source),
    segmentCounter: 0,
    blockCounter: 0,
    wrapperCounter: 0,
  };
  const mdChildren = parsed.tree.children as unknown as readonly MdNode[];
  const children = mdChildren.length
    ? mdChildren.map((node) =>
        buildBlockNode(state, node, { quoteDepth: 0 }),
      )
    : [
        buildTextBlock(
          state,
          {
            type: "paragraph",
            children: [],
            position: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 1, offset: 0 },
            },
          },
          "paragraph",
          { quoteDepth: 0 },
        ),
      ];

  const nodes: ProseMirrorNode[] = [];
  const segments: ProjectionSourceSegment[] = [];
  const wrappers: ProjectionWrapper[] = [];
  const blocks: ProjectionBlock[] = [];
  const specificImmutable: ProjectionImmutableRange[] = [];
  let offset = 0;
  for (const child of children) {
    nodes.push(child.node);
    segments.push(
      ...child.segments.map((segment) => shiftSegment(segment, offset)),
    );
    wrappers.push(
      ...child.wrappers.map((wrapper) => shiftWrapper(wrapper, offset)),
    );
    blocks.push(...child.blocks.map((block) => shiftBlock(block, offset)));
    specificImmutable.push(...child.immutable);
    offset += child.node.nodeSize;
  }
  const doc = editablePreviewSchema.nodes.doc.create(null, nodes);
  const immutableRanges = buildImmutableIndex(
    parsed.source,
    segments,
    specificImmutable,
  );
  return {
    parsed,
    doc,
    sourceMap: new EditableSourceMap({
      source: parsed.source,
      segments,
      blocks,
      wrappers,
      immutableRanges,
    }),
  };
}
