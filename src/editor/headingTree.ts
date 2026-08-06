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

function isFencedFence(line: string): { open: boolean; marker: string; info: string } | null {
  const m = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  if (!m) {
    return null;
  }
  return { open: true, marker: m[2][0], info: m[3] ?? "" };
}

/**
 * Parse ATX / Setext headings while skipping fenced code blocks.
 */
type RawHeading = Pick<HeadingNode, "line" | "headingEndLine" | "level" | "text">;

export function extractHeadings(source: string): RawHeading[] {
  const lines = source.length === 0 ? [] : source.split(/\r?\n/);
  const result: RawHeading[] = [];
  let inFence: { marker: string; length: number } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
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
        line: i + 1,
        headingEndLine: i + 1,
        level: atx[1].length,
        text: atx[2].trim(),
      });
      continue;
    }

    // Setext: current line is text, next line is === or ---
    if (
      i + 1 < lines.length &&
      line.trim() !== "" &&
      !line.startsWith(" ") &&
      !line.startsWith("\t") &&
      !line.startsWith("#")
    ) {
      const under = SETEXT_RE.exec(lines[i + 1]);
      if (under) {
        const level = under[1][0] === "=" ? 1 : 2;
        result.push({
          line: i + 1,
          headingEndLine: i + 2,
          level,
          text: line.trim(),
        });
        i += 1; // skip underline
      }
    }
  }

  return result;
}

function computeBodyEnds(
  headings: { line: number; level: number }[],
  totalLines: number,
): number[] {
  return headings.map((h, index) => {
    for (let j = index + 1; j < headings.length; j += 1) {
      if (headings[j].level <= h.level) {
        return headings[j].line;
      }
    }
    return totalLines + 1;
  });
}

/**
 * Build hierarchical heading tree with body ranges.
 */
export function buildHeadingTree(source: string): HeadingNode[] {
  const lines = source.length === 0 ? [] : source.split(/\r?\n/);
  const flat = extractHeadings(source);
  const bodyEnds = computeBodyEnds(flat, lines.length);

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
    // reset deeper counters
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
