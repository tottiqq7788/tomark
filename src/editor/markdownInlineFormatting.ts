import type { InlineFormat } from "@/shared/previewFormatting";

export interface FormatChange {
  from: number;
  to: number;
  insert: string;
  /** Selection to restore after the change (offsets in the new document). */
  selectionFrom: number;
  selectionTo: number;
}

const MARKERS: Record<Exclude<InlineFormat, "link">, { open: string; close: string }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  strike: { open: "~~", close: "~~" },
  code: { open: "`", close: "`" },
};

function trimEdges(
  source: string,
  from: number,
  to: number,
): { from: number; to: number; leading: string; trailing: string } {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(source[start] ?? "")) {
    start += 1;
  }
  while (end > start && /\s/.test(source[end - 1] ?? "")) {
    end -= 1;
  }
  return {
    from: start,
    to: end,
    leading: source.slice(from, start),
    trailing: source.slice(end, to),
  };
}

function chooseCodeFence(inner: string): { open: string; close: string } {
  let ticks = 1;
  const matches = inner.match(/`+/g);
  if (matches) {
    for (const m of matches) {
      ticks = Math.max(ticks, m.length + 1);
    }
  }
  const fence = "`".repeat(ticks);
  // CommonMark: if content starts/ends with a backtick, pad with spaces.
  const needsPad = inner.startsWith("`") || inner.endsWith("`") || inner.includes(fence);
  if (needsPad && !inner.startsWith(" ") && !inner.endsWith(" ")) {
    return { open: `${fence} `, close: ` ${fence}` };
  }
  if (inner.startsWith("`") || inner.endsWith("`")) {
    return { open: `${fence} `, close: ` ${fence}` };
  }
  return { open: fence, close: fence };
}

function escapeLinkText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function escapeLinkHref(href: string): string {
  return href.replace(/[()\s]/g, (ch) => encodeURIComponent(ch));
}

/** Reject javascript:/data: and other unsafe schemes. */
export function isSafeLinkHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return true;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return /^(https?|mailto|tel):/i.test(trimmed);
  }
  // Scheme-less relative / bare path / domain-looking text is allowed.
  return !trimmed.includes(":");
}

function findWrappingMarkers(
  source: string,
  from: number,
  to: number,
  open: string,
  close: string,
): { openFrom: number; closeTo: number } | null {
  if (from < open.length || to + close.length > source.length) {
    return null;
  }
  const before = source.slice(from - open.length, from);
  const after = source.slice(to, to + close.length);
  if (before === open && after === close) {
    return { openFrom: from - open.length, closeTo: to + close.length };
  }
  return null;
}

/**
 * Detect whether `from..to` is the full inner content of matching markers
 * that start at `outerFrom` and end at `outerTo` (element outer offsets).
 */
function unwrapUsingOuter(
  source: string,
  from: number,
  to: number,
  outerFrom: number,
  outerTo: number,
  open: string,
  close: string,
): FormatChange | null {
  if (outerTo <= outerFrom || from < outerFrom || to > outerTo) {
    return null;
  }
  const expectedOpen = source.slice(outerFrom, outerFrom + open.length);
  const expectedClose = source.slice(outerTo - close.length, outerTo);
  if (expectedOpen !== open || expectedClose !== close) {
    return null;
  }
  const innerFrom = outerFrom + open.length;
  const innerTo = outerTo - close.length;
  if (innerFrom > innerTo) {
    return null;
  }
  // Full unwrap when selection covers the entire inner content.
  if (from === innerFrom && to === innerTo) {
    const inner = source.slice(innerFrom, innerTo);
    return {
      from: outerFrom,
      to: outerTo,
      insert: inner,
      selectionFrom: outerFrom,
      selectionTo: outerFrom + inner.length,
    };
  }
  // Partial unwrap: split into left-formatted | plain | right-formatted.
  if (from >= innerFrom && to <= innerTo) {
    let left = source.slice(innerFrom, from);
    let mid = source.slice(from, to);
    let right = source.slice(to, innerTo);
    // Keep spaces outside markers so partial unwrap stays readable.
    let leftGap = "";
    let rightGap = "";
    if (left.endsWith(" ") || left.endsWith("\t")) {
      leftGap = left.slice(-1);
      left = left.slice(0, -1);
    }
    if (right.startsWith(" ") || right.startsWith("\t")) {
      rightGap = right.slice(0, 1);
      right = right.slice(1);
    }
    if (mid.startsWith(" ") || mid.startsWith("\t")) {
      leftGap += mid.slice(0, 1);
      mid = mid.slice(1);
    }
    if (mid.endsWith(" ") || mid.endsWith("\t")) {
      rightGap = mid.slice(-1) + rightGap;
      mid = mid.slice(0, -1);
    }
    const parts: string[] = [];
    if (left) {
      parts.push(`${open}${left}${close}`);
    }
    parts.push(`${leftGap}${mid}${rightGap}`);
    if (right) {
      parts.push(`${open}${right}${close}`);
    }
    const insert = parts.join("");
    const prefix =
      (left ? open.length + left.length + close.length : 0) + leftGap.length;
    const selFrom = outerFrom + prefix;
    return {
      from: outerFrom,
      to: outerTo,
      insert,
      selectionFrom: selFrom,
      selectionTo: selFrom + mid.length,
    };
  }
  return null;
}

function wrapSimple(
  source: string,
  from: number,
  to: number,
  open: string,
  close: string,
): FormatChange {
  const trimmed = trimEdges(source, from, to);
  if (trimmed.from >= trimmed.to) {
    // Nothing left after trim — wrap original range as-is.
    const inner = source.slice(from, to);
    const insert = `${open}${inner}${close}`;
    return {
      from,
      to,
      insert,
      selectionFrom: from + open.length,
      selectionTo: from + open.length + inner.length,
    };
  }
  const inner = source.slice(trimmed.from, trimmed.to);
  const insert = `${trimmed.leading}${open}${inner}${close}${trimmed.trailing}`;
  const selFrom = from + trimmed.leading.length + open.length;
  return {
    from,
    to,
    insert,
    selectionFrom: selFrom,
    selectionTo: selFrom + inner.length,
  };
}

export function toggleInlineFormat(
  source: string,
  from: number,
  to: number,
  format: Exclude<InlineFormat, "link">,
  options?: { active?: boolean; outerFrom?: number; outerTo?: number },
): FormatChange | null {
  if (from < 0 || to > source.length || to <= from) {
    return null;
  }

  if (format === "code") {
    return toggleCode(source, from, to, options);
  }

  const { open, close } = MARKERS[format];
  const wantUnwrap = options?.active === true;

  if (wantUnwrap && options?.outerFrom != null && options?.outerTo != null) {
    const viaOuter = unwrapUsingOuter(
      source,
      from,
      to,
      options.outerFrom,
      options.outerTo,
      open,
      close,
    );
    if (viaOuter) {
      return viaOuter;
    }
  }

  const immediate = findWrappingMarkers(source, from, to, open, close);
  if (immediate && wantUnwrap !== false) {
    // Prefer unwrap when markers hug the selection.
    const inner = source.slice(from, to);
    return {
      from: immediate.openFrom,
      to: immediate.closeTo,
      insert: inner,
      selectionFrom: immediate.openFrom,
      selectionTo: immediate.openFrom + inner.length,
    };
  }

  if (wantUnwrap) {
    // Active but couldn't locate markers — refuse rather than double-wrap.
    return null;
  }

  return wrapSimple(source, from, to, open, close);
}

function toggleCode(
  source: string,
  from: number,
  to: number,
  options?: { active?: boolean; outerFrom?: number; outerTo?: number },
): FormatChange | null {
  const wantUnwrap = options?.active === true;
  if (wantUnwrap && options?.outerFrom != null && options?.outerTo != null) {
    // Probe common fence lengths.
    for (let n = 1; n <= 5; n += 1) {
      const fence = "`".repeat(n);
      const viaOuter = unwrapUsingOuter(
        source,
        from,
        to,
        options.outerFrom,
        options.outerTo,
        fence,
        fence,
      );
      if (viaOuter) {
        return viaOuter;
      }
      const padded = unwrapUsingOuter(
        source,
        from,
        to,
        options.outerFrom,
        options.outerTo,
        `${fence} `,
        ` ${fence}`,
      );
      if (padded) {
        return padded;
      }
    }
  }

  // Immediate unwrap: detect matching fences around selection.
  for (let n = 5; n >= 1; n -= 1) {
    const fence = "`".repeat(n);
    const immediate = findWrappingMarkers(source, from, to, fence, fence);
    if (immediate && wantUnwrap !== false) {
      const inner = source.slice(from, to);
      return {
        from: immediate.openFrom,
        to: immediate.closeTo,
        insert: inner,
        selectionFrom: immediate.openFrom,
        selectionTo: immediate.openFrom + inner.length,
      };
    }
  }

  if (wantUnwrap) {
    return null;
  }

  const trimmed = trimEdges(source, from, to);
  const coreFrom = trimmed.from < trimmed.to ? trimmed.from : from;
  const coreTo = trimmed.from < trimmed.to ? trimmed.to : to;
  const inner = source.slice(coreFrom, coreTo);
  const { open, close } = chooseCodeFence(inner);
  const insert = `${source.slice(from, coreFrom)}${open}${inner}${close}${source.slice(coreTo, to)}`;
  const selFrom = from + (coreFrom - from) + open.length;
  return {
    from,
    to,
    insert,
    selectionFrom: selFrom,
    selectionTo: selFrom + inner.length,
  };
}

export function toggleLink(
  source: string,
  from: number,
  to: number,
  options: {
    active?: boolean;
    href?: string;
    outerFrom?: number;
    outerTo?: number;
  },
): FormatChange | null {
  if (from < 0 || to > source.length || to <= from) {
    return null;
  }

  if (options.active) {
    return unwrapLink(source, from, to, options.outerFrom, options.outerTo);
  }

  const href = options.href?.trim() ?? "";
  if (!isSafeLinkHref(href)) {
    return null;
  }

  const trimmed = trimEdges(source, from, to);
  const coreFrom = trimmed.from < trimmed.to ? trimmed.from : from;
  const coreTo = trimmed.from < trimmed.to ? trimmed.to : to;
  const inner = source.slice(coreFrom, coreTo);
  const open = `[${escapeLinkText(inner)}](`;
  const close = ")";
  const body = `${open}${escapeLinkHref(href)}${close}`;
  const insert = `${source.slice(from, coreFrom)}${body}${source.slice(coreTo, to)}`;
  const selFrom = from + (coreFrom - from) + 1;
  return {
    from,
    to,
    insert,
    selectionFrom: selFrom,
    selectionTo: selFrom + inner.length,
  };
}

function unwrapLink(
  source: string,
  from: number,
  to: number,
  outerFrom?: number,
  outerTo?: number,
): FormatChange | null {
  if (outerFrom == null || outerTo == null) {
    // Fallback: [text](url) hugging the selection text.
    if (from >= 1 && source[from - 1] === "[") {
      const afterText = source.indexOf("](", to);
      if (afterText === to) {
        const closeParen = source.indexOf(")", afterText + 2);
        if (closeParen > afterText) {
          const inner = source.slice(from, to);
          return {
            from: from - 1,
            to: closeParen + 1,
            insert: inner,
            selectionFrom: from - 1,
            selectionTo: from - 1 + inner.length,
          };
        }
      }
    }
    return null;
  }

  const slice = source.slice(outerFrom, outerTo);
  const match = slice.match(/^\[([\s\S]*?)\]\(([\s\S]*?)\)$/);
  if (!match) {
    return null;
  }
  const inner = match[1] ?? "";
  // Full unwrap of the link.
  if (from === outerFrom + 1 && to === outerFrom + 1 + inner.length) {
    return {
      from: outerFrom,
      to: outerTo,
      insert: inner,
      selectionFrom: outerFrom,
      selectionTo: outerFrom + inner.length,
    };
  }
  // Partial: leave surrounding text as plain + keep remaining linked parts simple
  // by unwrapping the whole link (safer than inventing nested link syntax).
  return {
    from: outerFrom,
    to: outerTo,
    insert: inner,
    selectionFrom: outerFrom + (from - (outerFrom + 1)),
    selectionTo: outerFrom + (to - (outerFrom + 1)),
  };
}
