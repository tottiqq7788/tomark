import type { SourcePatch, SourcePatchTransaction } from "@/shared/previewEditing";
import {
  analyzeFlowchartEditability,
  parseFlowchartSource,
} from "./flowchartSourceModel";

export interface MermaidVisualEditCommitRequest {
  readonly revision: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly expectedText: string;
  readonly nextText: string;
}

export type MermaidVisualEditCommitFailureReason =
  | "stale-preview"
  | "stale-revision"
  | "expected-text-mismatch"
  | "invalid-range"
  | "invalid-draft"
  | "unchanged";

export type MermaidVisualEditCommitBuild =
  | { readonly ok: true; readonly transaction: SourcePatchTransaction }
  | {
      readonly ok: false;
      readonly reason: MermaidVisualEditCommitFailureReason;
      readonly message: string;
    };

/**
 * Build a fence-body-only SourcePatchTransaction for Mermaid visual save.
 * Does not touch fence markers or surrounding Markdown.
 */
export function buildMermaidVisualEditTransaction(
  source: string,
  currentRevision: number,
  request: MermaidVisualEditCommitRequest,
): MermaidVisualEditCommitBuild {
  if (request.revision !== currentRevision) {
    return {
      ok: false,
      reason: "stale-revision",
      message: "预览内容已更新，请重新打开编辑器",
    };
  }
  if (
    !Number.isSafeInteger(request.bodyFrom) ||
    !Number.isSafeInteger(request.bodyTo) ||
    request.bodyFrom < 0 ||
    request.bodyTo < request.bodyFrom ||
    request.bodyTo > source.length
  ) {
    return {
      ok: false,
      reason: "invalid-range",
      message: "围栏正文范围无效",
    };
  }
  const current = source.slice(request.bodyFrom, request.bodyTo);
  if (current !== request.expectedText) {
    return {
      ok: false,
      reason: "expected-text-mismatch",
      message: "源码已变化，请重新打开编辑器",
    };
  }
  if (request.nextText === request.expectedText) {
    return {
      ok: false,
      reason: "unchanged",
      message: "没有需要保存的更改",
    };
  }
  const capability = analyzeFlowchartEditability(request.nextText);
  if (!capability.editable) {
    return {
      ok: false,
      reason: "invalid-draft",
      message: capability.message ?? "草稿不在可安全编辑的子集内",
    };
  }
  const parsed = parseFlowchartSource(request.nextText);
  if (!parsed.ok || !parsed.model.capability.editable) {
    return {
      ok: false,
      reason: "invalid-draft",
      message: "草稿解析失败，无法保存",
    };
  }

  const patch: SourcePatch = {
    from: request.bodyFrom,
    to: request.bodyTo,
    insert: request.nextText,
    expectedText: request.expectedText,
  };
  const transaction: SourcePatchTransaction = {
    revision: currentRevision,
    origin: "mermaid-visual",
    patches: [patch],
  };
  return { ok: true, transaction };
}
