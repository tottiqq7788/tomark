export type LineEnding = "lf" | "crlf";

export interface PreviewAnchor {
  id: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  blockType: string;
}

export interface RenderResult {
  html: string;
  lineToAnchor: Map<number, PreviewAnchor>;
  anchors: PreviewAnchor[];
}

export interface DocumentFormat {
  lineEnding: LineEnding;
  hasBom: boolean;
}

export interface LoadedDocument {
  path: string | null;
  fileName: string;
  content: string;
  format: DocumentFormat;
}

export const UNTITLED_NAME = "未命名.md";
