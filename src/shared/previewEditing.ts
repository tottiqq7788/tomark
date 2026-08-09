export type PreviewEditOrigin = "format" | "task-checkbox";

export interface SourcePatch {
  /** UTF-16 offsets into the exact Markdown source used for projection. */
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  /** Optimistic-lock guard for this individual source slice. */
  readonly expectedText: string;
}

export interface SourceSelectionRecovery {
  /** Selection offsets in the source after every patch has been applied. */
  readonly anchor: number;
  readonly head: number;
}

export interface SourcePatchTransaction {
  /** Revision of the CodeMirror document used to build the projection. */
  readonly revision: number;
  readonly patches: readonly SourcePatch[];
  readonly origin: PreviewEditOrigin;
  readonly selection?: SourceSelectionRecovery;
}

export type SourceTransactionFailureReason =
  | "stale-revision"
  | "empty-transaction"
  | "invalid-patch"
  | "overlapping-patches"
  | "expected-text-mismatch"
  | "invalid-selection";

export interface SourceTransactionFailure {
  readonly ok: false;
  readonly reason: SourceTransactionFailureReason;
  readonly revision: number;
  readonly patchIndex?: number;
}

export interface ValidatedSourcePatchTransaction {
  readonly ok: true;
  readonly patches: readonly SourcePatch[];
  readonly selection?: SourceSelectionRecovery;
}

export type SourceTransactionValidation =
  | ValidatedSourcePatchTransaction
  | SourceTransactionFailure;

export interface AppliedSourceTransaction {
  readonly ok: true;
  readonly revision: number;
  readonly value: string;
}

export type ApplySourceTransactionResult =
  | AppliedSourceTransaction
  | SourceTransactionFailure;

function isOffset(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validate and canonically sort a preview transaction without mutating it.
 * Same-position insertions are rejected because their ordering is ambiguous.
 */
export function validateSourcePatchTransaction(
  source: string,
  currentRevision: number,
  transaction: SourcePatchTransaction,
): SourceTransactionValidation {
  if (transaction.revision !== currentRevision) {
    return {
      ok: false,
      reason: "stale-revision",
      revision: currentRevision,
    };
  }
  if (transaction.patches.length === 0) {
    return {
      ok: false,
      reason: "empty-transaction",
      revision: currentRevision,
    };
  }

  const indexed = transaction.patches.map((patch, index) => ({ patch, index }));
  for (const { patch, index } of indexed) {
    if (
      !isOffset(patch.from) ||
      !isOffset(patch.to) ||
      patch.to < patch.from ||
      patch.to > source.length ||
      typeof patch.insert !== "string" ||
      typeof patch.expectedText !== "string"
    ) {
      return {
        ok: false,
        reason: "invalid-patch",
        revision: currentRevision,
        patchIndex: index,
      };
    }
    if (source.slice(patch.from, patch.to) !== patch.expectedText) {
      return {
        ok: false,
        reason: "expected-text-mismatch",
        revision: currentRevision,
        patchIndex: index,
      };
    }
  }

  indexed.sort(
    (a, b) =>
      a.patch.from - b.patch.from ||
      a.patch.to - b.patch.to ||
      a.index - b.index,
  );
  for (let index = 1; index < indexed.length; index += 1) {
    const previous = indexed[index - 1]!;
    const current = indexed[index]!;
    if (
      current.patch.from < previous.patch.to ||
      current.patch.from === previous.patch.from
    ) {
      return {
        ok: false,
        reason: "overlapping-patches",
        revision: currentRevision,
        patchIndex: current.index,
      };
    }
  }

  const nextLength = indexed.reduce(
    (length, { patch }) =>
      length - (patch.to - patch.from) + patch.insert.length,
    source.length,
  );
  const selection = transaction.selection;
  if (
    selection &&
    (!isOffset(selection.anchor) ||
      !isOffset(selection.head) ||
      selection.anchor > nextLength ||
      selection.head > nextLength)
  ) {
    return {
      ok: false,
      reason: "invalid-selection",
      revision: currentRevision,
    };
  }

  return {
    ok: true,
    patches: indexed.map(({ patch }) => patch),
    ...(selection ? { selection } : {}),
  };
}

/** Apply already source-guarded patches while preserving every other byte-unit. */
export function applySourcePatches(
  source: string,
  patches: readonly SourcePatch[],
): string {
  let result = source;
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const patch = patches[index]!;
    result =
      result.slice(0, patch.from) + patch.insert + result.slice(patch.to);
  }
  return result;
}

