/** Inline formats supported by the preview selection toolbar. */
export type InlineFormat = "bold" | "italic" | "strike" | "code" | "link";

/** Local edit produced by preview formatting and applied via CodeMirror. */
export interface FormatRangeChange {
  from: number;
  to: number;
  insert: string;
  selectionFrom?: number;
  selectionTo?: number;
  /** When set, apply only if the current document slice still matches. */
  expectedText?: string;
}

export interface SourceRange {
  from: number;
  to: number;
}

/** Reject javascript:/data:/protocol-relative and other unsafe schemes. */
export function isSafeLinkHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) {
    return false;
  }
  // Protocol-relative URLs inherit the page scheme — reject.
  if (trimmed.startsWith("//")) {
    return false;
  }
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return true;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return /^(https?|mailto|tel):/i.test(trimmed);
  }
  // Scheme-less relative / bare path / domain-looking text is allowed.
  return !trimmed.includes(":");
}

export interface FormatOuterRange extends SourceRange {
  href?: string | null;
}

export interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  /** Present when the whole selection sits inside one link. */
  linkHref: string | null;
  /** Tightest outer source ranges covering the selection, when active. */
  ranges: Partial<Record<InlineFormat, FormatOuterRange>>;
}

export interface PreviewFormatSelection {
  /** Character offsets into the rendered Markdown source. */
  from: number;
  to: number;
  /** Same block that owns both ends of the selection. */
  blockAnchorId: string;
  sourceLine: number;
  active: ActiveFormats;
  /** Viewport coordinates for floating the toolbar. */
  rect: {
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
  };
  /**
   * Exact source slice captured with the selection. Format apply must refuse
   * when `renderedSource.slice(from, to)` no longer matches.
   */
  expectedText?: string;
  /** Source revision when the editable snapshot was taken. */
  revision?: number;
  /** Stable ProseMirror range that produced the source offsets. */
  pmFrom?: number;
  pmTo?: number;
}

export type PreviewFormatAction =
  | { type: "toggle"; format: Exclude<InlineFormat, "link"> }
  | { type: "toggle-link"; href?: string };
