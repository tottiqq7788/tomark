import { Text } from "@codemirror/state";

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

const ATX_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const SETEXT_RE = /^(=+|-+)[ \t]*$/;

type RawHeading = Pick<HeadingNode, "line" | "headingEndLine" | "level" | "text">;

function isFencedFence(line: string): { open: boolean; marker: string; info: string } | null {
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) {
    return null;
  }
  return { open: true, marker: m[2][0], info: m[3] ?? "" };
}

export function looksLikeHeadingOrFenceLine(line: string): boolean {
  if (isFencedFence(line)) {
    return true;
  }
  if (ATX_RE.test(line)) {
    return true;
  }
  return SETEXT_RE.test(line);
}

/**
 * Parse ATX / Setext headings while skipping fenced code blocks.
 */
export function extractHeadingsFromDoc(doc: Text): RawHeading[] {
  const result: RawHeading[] = [];
  let inFence: { marker: string; length: number } | null = null;
  const total = doc.lines;

  for (let i = 1; i <= total; i += 1) {
    const line = doc.line(i).text;
    const fence = isFencedFence(line);
    if (inFence) {
      if (fence && fence.marker === inFence.marker) {
        const m = /^( {0,3})(`{3,}|~{3,})\s*$/.exec(line);
        if (m && m[2].length >= inFence.length) {
          inFence = null;
        }
      }
      continue;
    }
    if (fence) {
      const m = /^( {0,3})(`{3,}|~{3,})/.exec(line);
      if (m) {
        inFence = { marker: m[2][0], length: m[2].length };
      }
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      result.push({
        line: i,
        headingEndLine: i,
        level: atx[1].length,
        text: atx[2].trim(),
      });
      continue;
    }

    if (
      i + 1 <= total &&
      line.trim() !== "" &&
      !line.startsWith(" ") &&
      !line.startsWith("\t") &&
      !line.startsWith("#")
    ) {
      const under = SETEXT_RE.exec(doc.line(i + 1).text);
      if (under) {
        const level = under[1][0] === "=" ? 1 : 2;
        result.push({
          line: i,
          headingEndLine: i + 1,
          level,
          text: line.trim(),
        });
        i += 1;
      }
    }
  }

  return result;
}

export function extractHeadings(source: string): RawHeading[] {
  const doc = Text.of(source.length === 0 ? [""] : source.split(/\r?\n/));
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
  const doc = Text.of(source.length === 0 ? [""] : source.split(/\r?\n/));
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
