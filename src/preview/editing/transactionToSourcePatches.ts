import type { Node as ProseMirrorNode, Slice } from "prosemirror-model";
import type { Transaction } from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import {
  type EditableProjection,
  type MappedSourceSlice,
  type ProjectionBlock,
  type ProjectionImmutableRange,
} from "@/markdown/buildEditableProjection";
import {
  validateSourcePatchTransaction,
  type PreviewEditOrigin,
  type SourcePatch,
  type SourcePatchTransaction,
  type SourceSelectionRecovery,
} from "@/shared/previewEditing";
import { escapeMarkdownText } from "./markdownTextEscaping";

export type PatchTranslationFailureReason =
  | "stale-projection"
  | "empty-transaction"
  | "unsupported-step"
  | "read-only"
  | "unmapped-selection"
  | "structural-command-required"
  | "cross-block-edit"
  | "mixed-edit-context"
  | "invalid-generated-patches"
  | "table-structure-read-only"
  | "incompatible-blocks"
  | "unsupported-structure";

export interface PatchTranslationFailure {
  readonly ok: false;
  readonly reason: PatchTranslationFailureReason;
  readonly message?: string;
  readonly pmFrom?: number;
  readonly pmTo?: number;
}

export interface PatchTranslationSuccess {
  readonly ok: true;
  readonly sourceTransaction: SourcePatchTransaction;
}

export type PatchTranslationResult =
  | PatchTranslationSuccess
  | PatchTranslationFailure;

export interface TransactionToSourcePatchesOptions {
  readonly projection: EditableProjection;
  readonly transaction: Transaction;
  readonly revision: number;
  readonly origin: Exclude<PreviewEditOrigin, "structure">;
}

export type PreviewStructureCommand =
  | {
      readonly type: "split-block";
      readonly pmPosition: number;
    }
  | {
      readonly type: "join-backward" | "join-forward";
      readonly pmPosition: number;
    };

export interface StructureCommandToSourcePatchesOptions {
  readonly projection: EditableProjection;
  readonly command: PreviewStructureCommand;
  readonly revision: number;
}

interface MutablePatch {
  from: number;
  to: number;
  insert: string;
  expectedText: string;
}

interface OriginalReplace {
  readonly from: number;
  readonly to: number;
}

function mapStepPositionToOriginal(
  transaction: Transaction,
  stepIndex: number,
  position: number,
  association: -1 | 1,
): number {
  let mapped = position;
  for (let index = stepIndex - 1; index >= 0; index -= 1) {
    mapped = transaction.mapping.maps[index]!.invert().map(
      mapped,
      association,
    );
  }
  return mapped;
}

function fail(
  reason: PatchTranslationFailureReason,
  options: {
    message?: string;
    pmFrom?: number;
    pmTo?: number;
  } = {},
): PatchTranslationFailure {
  return { ok: false, reason, ...options };
}

function plainTextFromSlice(
  slice: Slice,
): { ok: true; text: string } | { ok: false } {
  let text = "";
  let valid = true;
  slice.content.descendants((node) => {
    if (node.isText) {
      text += node.text ?? "";
      return false;
    }
    if (node.isInline || node.isAtom || node.isBlock) {
      valid = false;
      return false;
    }
    return true;
  });
  return valid ? { ok: true, text } : { ok: false };
}

function pmCharacter(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): string {
  if (from < 0 || to > doc.content.size || to <= from) {
    return "";
  }
  return doc.textBetween(from, to, "", "");
}

function immutableGapCanFollowDeletedNewline(
  ranges: readonly ProjectionImmutableRange[],
  from: number,
  to: number,
): boolean {
  if (to <= from) {
    return false;
  }
  const touching = ranges.filter((range) => range.to > from && range.from < to);
  if (!touching.length) {
    return false;
  }
  let cursor = from;
  for (const range of touching.sort((a, b) => a.from - b.from)) {
    if (range.from > cursor) {
      return false;
    }
    if (range.kind !== "block-syntax" && range.kind !== "block-boundary") {
      return false;
    }
    cursor = Math.max(cursor, range.to);
  }
  return cursor >= to;
}

function patchesForMappedSlices(
  projection: EditableProjection,
  slices: readonly MappedSourceSlice[],
  pmFrom: number,
  pmTo: number,
  insertedText: string,
): { patches: MutablePatch[]; primary: MutablePatch } | PatchTranslationFailure {
  const contexts = new Set(slices.map((slice) => slice.context));
  if (insertedText && contexts.size > 1) {
    return fail("mixed-edit-context", { pmFrom, pmTo });
  }
  const source = projection.parsed.source;
  const block = projection.sourceMap.blockAt(pmFrom);
  const before = pmCharacter(projection.doc, pmFrom - 1, pmFrom);
  const after = pmCharacter(projection.doc, pmTo, pmTo + 1);
  const escaped = escapeMarkdownText(insertedText, {
    context: slices[0]!.context,
    before,
    after,
    atLineStart: block?.contentPmFrom === pmFrom,
  });

  const patches: MutablePatch[] = slices.map((slice, index) => {
    let to = slice.sourceTo;
    const next = slices[index + 1];
    const selectedText = projection.doc.textBetween(
      slice.pmFrom,
      slice.pmTo,
      "",
      "",
    );
    if (
      next &&
      selectedText.endsWith("\n") &&
      immutableGapCanFollowDeletedNewline(
        projection.sourceMap.immutableRanges,
        slice.sourceTo,
        next.sourceFrom,
      )
    ) {
      to = next.sourceFrom;
    }
    return {
      from: slice.sourceFrom,
      to,
      insert: index === 0 ? escaped : "",
      expectedText: source.slice(slice.sourceFrom, to),
    };
  });
  return { patches, primary: patches[0]! };
}

function rangeHasContent(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): boolean {
  if (to <= from) {
    return false;
  }
  let hasContent = false;
  doc.nodesBetween(from, to, (node) => {
    if ((node.isText && !!node.text) || node.isAtom) {
      hasContent = true;
      return false;
    }
    return !hasContent;
  });
  return hasContent;
}

function cleanupEmptyTouchedWrappers(
  projection: EditableProjection,
  transaction: Transaction,
  touched: readonly OriginalReplace[],
): MutablePatch[] {
  const source = projection.parsed.source;
  const patches: MutablePatch[] = [];
  const seen = new Set<string>();
  for (const wrapper of projection.sourceMap.wrappers) {
    const wasTouched = touched.some(
      (range) => range.from < wrapper.pmTo && range.to > wrapper.pmFrom,
    );
    if (!wasTouched) {
      continue;
    }
    const mappedFrom = Math.max(
      0,
      Math.min(
        transaction.doc.content.size,
        transaction.mapping.map(wrapper.pmFrom, 1),
      ),
    );
    const mappedTo = Math.max(
      mappedFrom,
      Math.min(
        transaction.doc.content.size,
        transaction.mapping.map(wrapper.pmTo, -1),
      ),
    );
    if (rangeHasContent(transaction.doc, mappedFrom, mappedTo)) {
      continue;
    }
    for (const range of wrapper.immutableRanges) {
      const key = `${range.from}:${range.to}`;
      if (range.to <= range.from || seen.has(key)) {
        continue;
      }
      seen.add(key);
      patches.push({
        from: range.from,
        to: range.to,
        insert: "",
        expectedText: source.slice(range.from, range.to),
      });
    }
  }
  return patches;
}

function finalPatchEnd(
  target: MutablePatch,
  sortedPatches: readonly SourcePatch[],
): number {
  let delta = 0;
  for (const patch of sortedPatches) {
    if (
      patch.from === target.from &&
      patch.to === target.to &&
      patch.insert === target.insert
    ) {
      return patch.from + delta + patch.insert.length;
    }
    delta += patch.insert.length - (patch.to - patch.from);
  }
  return Math.max(0, target.from + delta);
}

function finishTransaction(
  projection: EditableProjection,
  revision: number,
  origin: PreviewEditOrigin,
  patches: readonly MutablePatch[],
  primary: MutablePatch,
  selection?: SourceSelectionRecovery,
): PatchTranslationResult {
  const effective = patches.filter(
    (patch) => patch.expectedText !== patch.insert,
  );
  if (!effective.length) {
    return fail("empty-transaction");
  }
  const candidate: SourcePatchTransaction = {
    revision,
    origin,
    patches: effective,
    ...(selection ? { selection } : {}),
  };
  const validated = validateSourcePatchTransaction(
    projection.parsed.source,
    revision,
    candidate,
  );
  if (!validated.ok) {
    return fail("invalid-generated-patches", {
      message: validated.reason,
    });
  }
  const resolvedSelection =
    selection ??
    ({
      anchor: finalPatchEnd(primary, validated.patches),
      head: finalPatchEnd(primary, validated.patches),
    } satisfies SourceSelectionRecovery);
  return {
    ok: true,
    sourceTransaction: {
      revision,
      origin,
      patches: validated.patches,
      selection: resolvedSelection,
    },
  };
}

/**
 * Translate text-only ProseMirror replace steps into guarded Markdown patches.
 * Any structural or atom-touching step is rejected for an explicit command.
 */
export function transactionToSourcePatches(
  options: TransactionToSourcePatchesOptions,
): PatchTranslationResult {
  const { projection, transaction, revision, origin } = options;
  if (!transaction.before.eq(projection.doc)) {
    return fail("stale-projection");
  }
  if (!transaction.steps.length) {
    return fail("empty-transaction");
  }

  const patches: MutablePatch[] = [];
  const touched: OriginalReplace[] = [];
  let primary: MutablePatch | null = null;
  for (let index = 0; index < transaction.steps.length; index += 1) {
    const step = transaction.steps[index];
    if (!(step instanceof ReplaceStep)) {
      return fail("unsupported-step");
    }
    const inserted = plainTextFromSlice(step.slice);
    if (!inserted.ok) {
      return fail("structural-command-required", {
        pmFrom: step.from,
        pmTo: step.to,
      });
    }
    if (/[\r\n]/.test(inserted.text)) {
      return fail("structural-command-required", {
        message: "multiline text requires explicit block commands",
        pmFrom: step.from,
        pmTo: step.to,
      });
    }

    const originalFrom = mapStepPositionToOriginal(
      transaction,
      index,
      step.from,
      1,
    );
    const originalTo = mapStepPositionToOriginal(
      transaction,
      index,
      step.to,
      -1,
    );
    const resolved = projection.sourceMap.resolveEditableRange(
      originalFrom,
      originalTo,
    );
    if (!resolved.ok) {
      return fail(
        resolved.reason === "read-only" ? "read-only" : "unmapped-selection",
        { pmFrom: originalFrom, pmTo: originalTo },
      );
    }
    if (resolved.blockIds.length !== 1) {
      return fail("cross-block-edit", {
        pmFrom: originalFrom,
        pmTo: originalTo,
      });
    }
    const mapped = patchesForMappedSlices(
      projection,
      resolved.slices,
      originalFrom,
      originalTo,
      inserted.text,
    );
    if ("reason" in mapped) {
      return mapped;
    }
    patches.push(...mapped.patches);
    primary = mapped.primary;
    touched.push({ from: originalFrom, to: originalTo });
  }

  patches.push(...cleanupEmptyTouchedWrappers(projection, transaction, touched));
  return finishTransaction(
    projection,
    revision,
    origin,
    patches,
    primary!,
  );
}

function quoteOnlyPrefix(prefix: string): string {
  const match = /^(?:[ \t]*>[ \t]?)+/.exec(prefix);
  return match?.[0] ?? "";
}

function blockIsEmpty(projection: EditableProjection, block: ProjectionBlock): boolean {
  return !projection.sourceMap.segments.some(
    (segment) =>
      segment.blockId === block.id &&
      segment.policy === "editable" &&
      segment.pmTo > segment.pmFrom,
  );
}

function wrapperBoundariesAt(
  projection: EditableProjection,
  pmPosition: number,
): { close: string; open: string } {
  const wrappers = projection.sourceMap.wrappers
    .filter(
      (wrapper) =>
        pmPosition > wrapper.pmFrom && pmPosition < wrapper.pmTo,
    )
    .sort((a, b) => a.sourceFrom - b.sourceFrom);
  const open = wrappers
    .map((wrapper) => wrapper.immutableRanges[0]?.text ?? "")
    .join("");
  const close = wrappers
    .slice()
    .reverse()
    .map(
      (wrapper) =>
        wrapper.immutableRanges[wrapper.immutableRanges.length - 1]?.text ??
        "",
    )
    .join("");
  return { close, open };
}

function adjustStructureSourceOffset(
  projection: EditableProjection,
  pmPosition: number,
  mappedOffset: number,
): number {
  const starting = projection.sourceMap.wrappers.filter(
    (wrapper) => wrapper.pmFrom === pmPosition,
  );
  if (starting.length) {
    return Math.min(...starting.map((wrapper) => wrapper.sourceFrom));
  }
  const ending = projection.sourceMap.wrappers.filter(
    (wrapper) => wrapper.pmTo === pmPosition,
  );
  if (ending.length) {
    return Math.max(...ending.map((wrapper) => wrapper.sourceTo));
  }
  return mappedOffset;
}

function splitHeading(
  projection: EditableProjection,
  block: ProjectionBlock,
  pmPosition: number,
  sourceOffset: number,
  revision: number,
): PatchTranslationResult {
  const heading = block.context.heading!;
  if (
    heading.style === "setext" &&
    sourceOffset === block.contentSourceFrom
  ) {
    return fail("unsupported-structure", {
      message: "an empty Setext heading cannot retain its source style",
    });
  }
  const source = projection.parsed.source;
  const lineEnding = projection.parsed.lineEnding;
  const remainder = source.slice(sourceOffset, block.contentSourceTo);
  const suffix = source.slice(block.contentSourceTo, block.sourceTo);
  const boundaries = wrapperBoundariesAt(projection, pmPosition);
  const patch: MutablePatch = {
    from: sourceOffset,
    to: block.sourceTo,
    insert: `${boundaries.close}${suffix}${lineEnding}${boundaries.open}${remainder}`,
    expectedText: source.slice(sourceOffset, block.sourceTo),
  };
  const cursor =
    sourceOffset +
    boundaries.close.length +
    suffix.length +
    lineEnding.length +
    boundaries.open.length;
  return finishTransaction(
    projection,
    revision,
    "structure",
    [patch],
    patch,
    { anchor: cursor, head: cursor },
  );
}

function splitTextBlock(
  projection: EditableProjection,
  block: ProjectionBlock,
  pmPosition: number,
  sourceOffset: number,
  revision: number,
): PatchTranslationResult {
  if (block.context.tableCell) {
    return fail("table-structure-read-only");
  }
  if (block.context.heading) {
    return splitHeading(
      projection,
      block,
      pmPosition,
      sourceOffset,
      revision,
    );
  }

  const source = projection.parsed.source;
  if (block.context.listItem && blockIsEmpty(projection, block)) {
    const prefixFrom = lineStartAt(source, block.contentSourceFrom);
    const prefix = source.slice(prefixFrom, block.contentSourceFrom);
    const replacement = quoteOnlyPrefix(prefix);
    const patch: MutablePatch = {
      from: prefixFrom,
      to: block.contentSourceFrom,
      insert: replacement,
      expectedText: prefix,
    };
    return finishTransaction(
      projection,
      revision,
      "structure",
      [patch],
      patch,
      {
        anchor: prefixFrom + replacement.length,
        head: prefixFrom + replacement.length,
      },
    );
  }

  const lineEnding = projection.parsed.lineEnding;
  const prefix = block.context.linePrefix;
  const hasListMarker =
    !!block.context.listItem &&
    /(?:[*+-]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?$/.test(prefix);
  const nextListPrefix = prefix.replace(/\[[xX]\]/, "[ ]");
  const separator = hasListMarker
    ? `${lineEnding}${nextListPrefix}`
    : block.context.quoteDepth > 0
      ? `${lineEnding}${prefix}${lineEnding}${prefix}`
      : `${lineEnding}${lineEnding}${prefix}`;
  const boundaries = wrapperBoundariesAt(projection, pmPosition);
  const inserted = `${boundaries.close}${separator}${boundaries.open}`;
  const patch: MutablePatch = {
    from: sourceOffset,
    to: sourceOffset,
    insert: inserted,
    expectedText: "",
  };
  // Place the caret at the start of the new block's body (after separators /
  // list-or-quote prefixes and any reopened inline wrappers).
  const cursor =
    sourceOffset +
    boundaries.close.length +
    separator.length +
    boundaries.open.length;
  return finishTransaction(
    projection,
    revision,
    "structure",
    [patch],
    patch,
    { anchor: cursor, head: cursor },
  );
}

function lineStartAt(source: string, offset: number): number {
  const newline = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return newline < 0 ? 0 : newline + 1;
}

function sameListLevel(
  left: ProjectionBlock,
  right: ProjectionBlock,
): boolean {
  const a = left.context.listItem;
  const b = right.context.listItem;
  if (!a && !b) {
    return true;
  }
  return !!(
    a &&
    b &&
    a.ordered === b.ordered &&
    a.delimiter === b.delimiter &&
    a.indentation === b.indentation
  );
}

function blocksCanJoin(left: ProjectionBlock, right: ProjectionBlock): boolean {
  return (
    left.policy === "editable" &&
    right.policy === "editable" &&
    left.nodeType === "paragraph" &&
    right.nodeType === "paragraph" &&
    !left.context.tableCell &&
    !right.context.tableCell &&
    left.context.quoteDepth === right.context.quoteDepth &&
    sameListLevel(left, right)
  );
}

function adjacentBlock(
  blocks: readonly ProjectionBlock[],
  block: ProjectionBlock,
  direction: -1 | 1,
): ProjectionBlock | null {
  if (direction < 0) {
    return (
      blocks
        .filter((candidate) => candidate.pmTo <= block.pmFrom)
        .sort((a, b) => b.pmTo - a.pmTo)[0] ?? null
    );
  }
  return (
    blocks
      .filter((candidate) => candidate.pmFrom >= block.pmTo)
      .sort((a, b) => a.pmFrom - b.pmFrom)[0] ?? null
  );
}

function joinBlocks(
  projection: EditableProjection,
  command: Extract<
    PreviewStructureCommand,
    { type: "join-backward" | "join-forward" }
  >,
  revision: number,
): PatchTranslationResult {
  const current = projection.sourceMap.blockAt(command.pmPosition);
  if (!current || current.policy !== "editable") {
    return fail("read-only");
  }
  const direction = command.type === "join-backward" ? -1 : 1;
  const other = adjacentBlock(projection.sourceMap.blocks, current, direction);
  if (!other) {
    return fail("incompatible-blocks");
  }
  const left = direction < 0 ? other : current;
  const right = direction < 0 ? current : other;
  if (!blocksCanJoin(left, right)) {
    return fail("incompatible-blocks");
  }
  if (right.contentSourceFrom < left.contentSourceTo) {
    return fail("incompatible-blocks");
  }
  const source = projection.parsed.source;
  const patch: MutablePatch = {
    from: left.contentSourceTo,
    to: right.contentSourceFrom,
    insert: "",
    expectedText: source.slice(
      left.contentSourceTo,
      right.contentSourceFrom,
    ),
  };
  return finishTransaction(
    projection,
    revision,
    "structure",
    [patch],
    patch,
  );
}

/** Translate explicit Enter/Backspace/Delete commands without serialization. */
export function structureCommandToSourcePatches(
  options: StructureCommandToSourcePatchesOptions,
): PatchTranslationResult {
  const { projection, command, revision } = options;
  if (command.type === "join-backward" || command.type === "join-forward") {
    return joinBlocks(projection, command, revision);
  }
  const block = projection.sourceMap.blockAt(command.pmPosition);
  if (!block || block.policy !== "editable") {
    return fail("read-only");
  }
  const mapped = projection.sourceMap.mapPmPosition(command.pmPosition, 1);
  if (!mapped || mapped.segment.blockId !== block.id) {
    return fail("unmapped-selection", {
      pmFrom: command.pmPosition,
      pmTo: command.pmPosition,
    });
  }
  const sourceOffset = adjustStructureSourceOffset(
    projection,
    command.pmPosition,
    mapped.sourceOffset,
  );
  return splitTextBlock(
    projection,
    block,
    command.pmPosition,
    sourceOffset,
    revision,
  );
}

