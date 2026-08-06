export type LineEnding = "lf" | "crlf";

export type TextEncodingId =
  | "utf8"
  | "utf16Le"
  | "utf16Be"
  | "windows1252"
  | "gbk"
  | "gb18030"
  | "big5"
  | "shiftJis"
  | "eucKr";

export type DetectionConfidence = "certain" | "high" | "tentative";

export type DetectionSource =
  | "bom"
  | "utf8Strict"
  | "utf16Heuristic"
  | "chardet"
  | "userHint"
  | "default";

export type EncodingHint =
  | "auto"
  | "western"
  | "simplifiedChinese"
  | "traditionalChinese"
  | "japanese"
  | "korean";

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
  encoding: TextEncodingId;
  confidence: DetectionConfidence;
  source: DetectionSource;
  allowDirectOverwrite: boolean;
}

export interface LoadedDocument {
  path: string | null;
  fileName: string;
  content: string;
  format: DocumentFormat;
}

export const UNTITLED_NAME = "未命名.md";

export function defaultDocumentFormat(): DocumentFormat {
  return {
    lineEnding: "lf",
    hasBom: false,
    encoding: "utf8",
    confidence: "certain",
    source: "default",
    allowDirectOverwrite: true,
  };
}

export function utf8DocumentFormat(
  lineEnding: LineEnding = "lf",
  hasBom = false,
): DocumentFormat {
  return {
    lineEnding,
    hasBom,
    encoding: "utf8",
    confidence: "certain",
    source: "default",
    allowDirectOverwrite: true,
  };
}
