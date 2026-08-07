/** Inline formats supported by the preview selection toolbar. */
export type InlineFormat = "bold" | "italic" | "strike" | "code" | "link";

export interface SourceRange {
  from: number;
  to: number;
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
}

export type PreviewFormatAction =
  | { type: "toggle"; format: Exclude<InlineFormat, "link"> }
  | { type: "toggle-link"; href?: string };
