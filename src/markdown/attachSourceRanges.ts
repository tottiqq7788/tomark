import type { Element, Parents, Root, RootContent, Text } from "hast";

const SKIP_WRAP_ANCESTORS = new Set(["pre", "script", "style"]);

function isElement(node: RootContent | Parents): node is Element {
  return node.type === "element";
}

function isText(node: RootContent | Parents): node is Text {
  return node.type === "text";
}

function readOffsets(
  node: Element | Text,
): { from: number; to: number } | null {
  const pos = node.position;
  if (
    pos?.start?.offset == null ||
    pos?.end?.offset == null ||
    !Number.isFinite(pos.start.offset) ||
    !Number.isFinite(pos.end.offset) ||
    pos.end.offset < pos.start.offset
  ) {
    return null;
  }
  return { from: pos.start.offset, to: pos.end.offset };
}

function formatName(tag: string): string | null {
  switch (tag) {
    case "strong":
      return "bold";
    case "em":
      return "italic";
    case "del":
      return "strike";
    case "code":
      return "code";
    case "a":
      return "link";
    default:
      return null;
  }
}

function wrapExactText(node: Text): Element | Text {
  const offsets = readOffsets(node);
  if (!offsets) {
    return node;
  }
  // Only wrap when source span length matches visible text — skips code
  // fence markers and other cases where rehype positions include delimiters.
  if (offsets.to - offsets.from !== node.value.length) {
    return node;
  }
  if (node.value.length === 0) {
    return node;
  }
  return {
    type: "element",
    tagName: "span",
    properties: {
      dataTmFrom: String(offsets.from),
      dataTmTo: String(offsets.to),
    },
    children: [{ type: "text", value: node.value }],
    position: node.position,
  };
}

/**
 * Stamp character-level source offsets onto inline text and format nodes so
 * preview selections can map back to Markdown source ranges.
 *
 * Runs after block anchors are attached. Skips fenced code blocks (`pre`).
 */
export function attachSourceRanges(tree: Root): void {
  const visit = (node: Root | Element, insideSkip: boolean) => {
    if (!isElement(node) && node.type !== "root") {
      return;
    }

    const tag = isElement(node) ? node.tagName.toLowerCase() : "";
    const skipHere = insideSkip || SKIP_WRAP_ANCESTORS.has(tag);

    if (isElement(node) && !skipHere) {
      const format = formatName(tag);
      // Inline code only — fenced blocks live under `pre`.
      if (format && !(tag === "code" && insideSkip)) {
        const offsets = readOffsets(node);
        if (offsets) {
          node.properties = {
            ...node.properties,
            dataTmFormat: format,
            dataTmFrom: String(offsets.from),
            dataTmTo: String(offsets.to),
          };
          if (format === "link") {
            const href = node.properties.href;
            if (typeof href === "string" && href.length > 0) {
              node.properties.dataTmHref = href;
            }
          }
        }
      }
    }

    if (!("children" in node) || !Array.isArray(node.children)) {
      return;
    }

    const nextChildren: RootContent[] = [];
    for (const child of node.children) {
      if (isText(child) && !skipHere) {
        nextChildren.push(wrapExactText(child));
        continue;
      }
      if (isElement(child)) {
        visit(child, skipHere);
      }
      nextChildren.push(child);
    }
    node.children = nextChildren;
  };

  visit(tree, false);
}
