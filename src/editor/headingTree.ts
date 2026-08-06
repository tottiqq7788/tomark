import { Text } from "@codemirror/state";
import { commonmarkLanguage } from "@codemirror/lang-markdown";

export interface HeadingNode {
  /** 1-based document line of the heading title text */
  line: number;
  /** Last line belonging to the heading syntax (ATX: same as line; Setext: underline) */
  headingEndLine: number;
  level: number;
  text: string;
  /** Inclusive start line of foldable body (after heading syntax) */
  bodyStart: number;
  /** Exclusive end line (1-based next line after section) */
  bodyEndExclusive: number;
  /** Path of ordinals among siblings at each level, e.g. [0, 1] */
  path: number[];
  children: HeadingNode[];
}

const ATX_LINE_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const SETEXT_LINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const FENCE_LINE_RE = /^ {0,3}(?:`{3,}|~{3,})/;
const ATX_NODE_RE = /^ATXHeading([1-6])$/;
const SETEXT_NODE_RE = /^SetextHeading([12])$/;

type RawHeading = Pick<HeadingNode, "line" | "headingEndLine" | "level" | "text">;

export function looksLikeHeadingOrFenceLine(line: string): boolean {
  return (
    FENCE_LINE_RE.test(line) ||
    ATX_LINE_RE.test(line) ||
    SETEXT_LINE_RE.test(line)
  );
}

/**
 * Parse top-level CommonMark headings with the same grammar used by CodeMirror.
 * A Text-backed input avoids materializing the whole document as one string.
 */
export function extractHeadingsFromDoc(doc: Text): RawHeading[] {
  const result: RawHeading[] = [];
  const tree = commonmarkLanguage.parser.parse({
    length: doc.length,
    lineChunks: false,
    chunk(from: number) {
      return doc.sliceString(from, Math.min(doc.length, from + 4096));
    },
    read(from: number, to: number) {
      return doc.sliceString(from, to);
    },
  });
  const cursor = tree.cursor();

  do {
    if (cursor.node.parent?.name !== "Document") {
      continue;
    }
    const atx = ATX_NODE_RE.exec(cursor.name);
    const setext = SETEXT_NODE_RE.exec(cursor.name);
    const match = atx ?? setext;
    if (!match) {
      continue;
    }

    const node = cursor.node;
    const marks = node.getChildren("HeaderMark");
    const openingMark = marks[0];
    const closingMark = atx && marks.length > 1 ? marks[marks.length - 1] : null;
    const textFrom = atx ? (openingMark?.to ?? node.from) : node.from;
    const textTo = atx
      ? (closingMark?.from ?? node.to)
      : (marks[marks.length - 1]?.from ?? node.to);
    const text = doc
      .sliceString(textFrom, textTo)
      .replace(/[ \t]*\n[ \t]*/g, " ")
      .trim();

    result.push({
      line: doc.lineAt(node.from).number,
      headingEndLine: doc.lineAt(Math.max(node.from, node.to - 1)).number,
      level: Number(match[1]),
      text,
    });
  } while (cursor.next());

  return result;
}

export function extractHeadings(source: string): RawHeading[] {
  const doc = Text.of(
    source.length === 0 ? [""] : source.split(/\r\n?|\n/),
  );
  return extractHeadingsFromDoc(doc);
}

function computeBodyEnds(
  headings: { line: number; level: number }[],
  totalLines: number,
): number[] {
  const ends = new Array<number>(headings.length);
  const stack: number[] = [];

  for (let index = 0; index < headings.length; index += 1) {
    const level = headings[index].level;
    while (stack.length > 0 && headings[stack[stack.length - 1]].level >= level) {
      const prev = stack.pop()!;
      ends[prev] = headings[index].line;
    }
    stack.push(index);
  }

  while (stack.length > 0) {
    ends[stack.pop()!] = totalLines + 1;
  }

  return ends;
}

function buildTreeFromRaw(flat: RawHeading[], totalLines: number): HeadingNode[] {
  const bodyEnds = computeBodyEnds(flat, totalLines);
  const nodes: HeadingNode[] = flat.map((h, i) => ({
    ...h,
    bodyStart: h.headingEndLine + 1,
    bodyEndExclusive: bodyEnds[i],
    path: [],
    children: [],
  }));

  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];
  const siblingCounters: number[] = [];

  for (const node of nodes) {
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
      siblingCounters.length = stack.length + 1;
    }

    const depth = stack.length;
    if (siblingCounters.length <= depth) {
      siblingCounters.length = depth + 1;
    }
    if (siblingCounters[depth] === undefined) {
      siblingCounters[depth] = 0;
    }
    const ordinal = siblingCounters[depth];
    siblingCounters[depth] = ordinal + 1;
    siblingCounters.length = depth + 1;

    const parentPath = stack.length > 0 ? stack[stack.length - 1].path : [];
    node.path = [...parentPath, ordinal];

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

/**
 * Build hierarchical heading tree with body ranges.
 */
export function buildHeadingTreeFromDoc(doc: Text): HeadingNode[] {
  return buildTreeFromRaw(extractHeadingsFromDoc(doc), doc.lines);
}

export function buildHeadingTree(source: string): HeadingNode[] {
  const doc = Text.of(
    source.length === 0 ? [""] : source.split(/\r\n?|\n/),
  );
  return buildHeadingTreeFromDoc(doc);
}

export function mapHeadingTreeLines(
  roots: HeadingNode[],
  mapLine: (line: number) => number | null,
): HeadingNode[] {
  const mapNode = (node: HeadingNode): HeadingNode | null => {
    const line = mapLine(node.line);
    const headingEndLine = mapLine(node.headingEndLine);
    const bodyStart = mapLine(node.bodyStart);
    const bodyEndMapped =
      node.bodyEndExclusive > node.bodyStart
        ? mapLine(node.bodyEndExclusive - 1)
        : mapLine(node.bodyStart);
    if (
      line === null ||
      headingEndLine === null ||
      bodyStart === null ||
      bodyEndMapped === null
    ) {
      return null;
    }
    const children = node.children
      .map(mapNode)
      .filter((child): child is HeadingNode => child !== null);
    return {
      ...node,
      line,
      headingEndLine,
      bodyStart,
      bodyEndExclusive: bodyEndMapped + 1,
      children,
    };
  };

  return roots.map(mapNode).filter((node): node is HeadingNode => node !== null);
}

export function flattenHeadingTree(roots: HeadingNode[]): HeadingNode[] {
  const out: HeadingNode[] = [];
  const walk = (nodes: HeadingNode[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

export function pathKey(path: number[]): string {
  return path.join(".");
}

/** True when `prefix` is an exact path-array prefix of `path` (safe vs string startsWith). */
export function isPathPrefix(prefix: number[], path: number[]): boolean {
  if (prefix.length > path.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] !== path[i]) {
      return false;
    }
  }
  return true;
}
