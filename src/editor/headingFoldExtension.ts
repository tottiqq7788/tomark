import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  gutter,
  GutterMarker,
  type BlockInfo,
} from "@codemirror/view";
import {
  buildHeadingTreeFromDoc,
  flattenHeadingTree,
  looksLikeHeadingOrFenceLine,
  mapHeadingTreeLines,
  pathKey,
  type HeadingNode,
} from "./headingTree";

export interface CollapsedHeading {
  level: number;
  text: string;
  line: number;
  bodyStart: number;
  bodyEndExclusive: number;
}

export const resetHeadingFolds = StateEffect.define<boolean>();
export const toggleHeadingFold = StateEffect.define<number>();

class FoldMarker extends GutterMarker {
  constructor(readonly collapsed: boolean) {
    super();
  }

  eq(other: FoldMarker) {
    return this.collapsed === other.collapsed;
  }

  toDOM() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-heading-fold-marker";
    btn.textContent = this.collapsed ? "▸" : "▾";
    btn.title = this.collapsed ? "展开" : "折叠";
    btn.setAttribute("aria-label", btn.title);
    return btn;
  }
}

function lineCount(state: EditorState): number {
  return state.doc.lines;
}

function lineNumberAt(view: EditorView, block: BlockInfo): number {
  return view.state.doc.lineAt(block.from).number;
}

function collectCollapsedFromFlat(
  flat: HeadingNode[],
  collapsedKeys: Set<string>,
): CollapsedHeading[] {
  return flat
    .filter((h) => collapsedKeys.has(pathKey(h.path)))
    .map((h) => ({
      level: h.level,
      text: h.text,
      line: h.line,
      bodyStart: h.bodyStart,
      bodyEndExclusive: h.bodyEndExclusive,
    }));
}

/**
 * Default open-document folds: collapse all headings, then expand the first-child
 * chain from the first root until a heading with no children (so its body is visible).
 */
export function defaultCollapsedKeys(
  roots: HeadingNode[],
  flat: HeadingNode[],
): Set<string> {
  const collapsed = new Set(flat.map((h) => pathKey(h.path)));
  let node: HeadingNode | undefined = roots[0];
  while (node) {
    collapsed.delete(pathKey(node.path));
    node = node.children[0];
  }
  return collapsed;
}

function visibleCollapsedRanges(
  roots: HeadingNode[],
  collapsedKeys: Set<string>,
): { fromLine: number; toLineExclusive: number; headingLine: number }[] {
  const ranges: {
    fromLine: number;
    toLineExclusive: number;
    headingLine: number;
  }[] = [];

  const walk = (nodes: HeadingNode[], ancestorCollapsed: boolean) => {
    for (const node of nodes) {
      const key = pathKey(node.path);
      const collapsed = collapsedKeys.has(key);
      if (!ancestorCollapsed && collapsed && node.bodyEndExclusive > node.bodyStart) {
        ranges.push({
          fromLine: node.bodyStart,
          toLineExclusive: node.bodyEndExclusive,
          headingLine: node.line,
        });
      }
      walk(node.children, ancestorCollapsed || collapsed);
    }
  };

  walk(roots, false);
  return ranges;
}

function reconcileCollapsed(
  prev: CollapsedHeading[],
  _roots: HeadingNode[],
  flat: HeadingNode[],
  isInitial: boolean,
): Set<string> {
  if (isInitial) {
    return defaultCollapsedKeys(_roots, flat);
  }

  const next = new Set<string>();
  const usedHeadings = new Set<number>();

  const findNearest = (
    previous: CollapsedHeading,
    predicate: (heading: HeadingNode) => boolean,
  ) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < flat.length; index += 1) {
      if (usedHeadings.has(index) || !predicate(flat[index])) {
        continue;
      }
      const distance = Math.abs(previous.line - flat[index].line);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }
    return bestIndex;
  };

  for (const previous of prev) {
    let matchedIndex = findNearest(
      previous,
      (heading) =>
        heading.line === previous.line &&
        heading.level === previous.level &&
        heading.text === previous.text,
    );
    if (matchedIndex < 0) {
      matchedIndex = findNearest(
        previous,
        (heading) =>
          heading.line === previous.line && heading.level === previous.level,
      );
    }
    if (matchedIndex < 0) {
      matchedIndex = findNearest(
        previous,
        (heading) => heading.line === previous.line,
      );
    }
    if (matchedIndex < 0) {
      matchedIndex = findNearest(
        previous,
        (heading) =>
          heading.level === previous.level && heading.text === previous.text,
      );
    }

    if (matchedIndex >= 0) {
      usedHeadings.add(matchedIndex);
      next.add(pathKey(flat[matchedIndex].path));
    }
  }

  return next;
}

interface FoldFieldValue {
  collapsedKeys: Set<string>;
  roots: HeadingNode[];
  flat: HeadingNode[];
  decorations: ReturnType<typeof Decoration.set>;
  headingLines: Map<number, boolean>;
}

function buildDecorations(
  state: EditorState,
  roots: HeadingNode[],
  flat: HeadingNode[],
  collapsedKeys: Set<string>,
): { decorations: ReturnType<typeof Decoration.set>; headingLines: Map<number, boolean> } {
  const ranges = visibleCollapsedRanges(roots, collapsedKeys);
  const widgets: { from: number; to: number }[] = [];
  const headingLines = new Map<number, boolean>();

  for (const h of flat) {
    headingLines.set(h.line, collapsedKeys.has(pathKey(h.path)));
  }

  for (const range of ranges) {
    if (range.fromLine > lineCount(state)) {
      continue;
    }
    const from = state.doc.line(range.fromLine).from;
    const lastLine = Math.min(range.toLineExclusive - 1, lineCount(state));
    if (lastLine < range.fromLine) {
      continue;
    }
    const to = state.doc.line(lastLine).to;
    if (to > from) {
      widgets.push({ from, to });
    }
  }

  widgets.sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const w of widgets) {
    const last = merged[merged.length - 1];
    if (last && w.from < last.to) {
      continue;
    }
    merged.push(w);
  }

  return {
    decorations: Decoration.set(
      merged.map((w) =>
        Decoration.replace({
          block: true,
        }).range(w.from, w.to),
      ),
    ),
    headingLines,
  };
}

function mapCollapsedThroughTransaction(
  prev: CollapsedHeading[],
  tr: Transaction,
): CollapsedHeading[] {
  if (!tr.docChanged) {
    return prev;
  }
  return prev
    .map((c) => {
      try {
        const oldPos = tr.startState.doc.line(c.line).from;
        const newPos = tr.changes.mapPos(oldPos, 1);
        if (newPos < 0 || newPos > tr.state.doc.length) {
          return null;
        }
        const newLine = tr.state.doc.lineAt(newPos).number;
        return { ...c, line: newLine };
      } catch {
        return null;
      }
    })
    .filter((c): c is CollapsedHeading => c !== null);
}

function mapLineThroughTransaction(tr: Transaction, line: number): number | null {
  try {
    if (line < 1 || line > tr.startState.doc.lines) {
      return null;
    }
    const oldPos = tr.startState.doc.line(line).from;
    const newPos = tr.changes.mapPos(oldPos, 1);
    if (newPos < 0 || newPos > tr.state.doc.length) {
      return null;
    }
    return tr.state.doc.lineAt(newPos).number;
  } catch {
    return null;
  }
}

function touchedLines(tr: Transaction): number[] {
  const lines = new Set<number>();
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const start = tr.state.doc.lineAt(fromB).number;
    const end = tr.state.doc.lineAt(Math.max(fromB, toB)).number;
    for (let line = Math.max(1, start - 1); line <= end + 1; line += 1) {
      if (line <= tr.state.doc.lines) {
        lines.add(line);
      }
    }
  });
  return [...lines].sort((a, b) => a - b);
}

function changeInsertsNewline(tr: Transaction): boolean {
  let hasNewline = false;
  tr.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    if (inserted.toString().includes("\n")) {
      hasNewline = true;
    }
  });
  return hasNewline;
}

function isStructuralLine(
  tr: Transaction,
  line: number,
  flat: HeadingNode[],
): boolean {
  if (line < 1 || line > tr.state.doc.lines) {
    return false;
  }
  if (flat.some((h) => h.line === line || h.headingEndLine === line)) {
    return true;
  }
  return looksLikeHeadingOrFenceLine(tr.state.doc.line(line).text);
}

export type RebuildStrategy = "reuse" | "remap" | "full";

function oldTouchedLines(tr: Transaction): number[] {
  const lines = new Set<number>();
  tr.changes.iterChangedRanges((fromA, toA) => {
    const start = tr.startState.doc.lineAt(fromA).number;
    const end = tr.startState.doc.lineAt(Math.max(fromA, toA)).number;
    for (let line = Math.max(1, start - 1); line <= end + 1; line += 1) {
      if (line <= tr.startState.doc.lines) {
        lines.add(line);
      }
    }
  });
  return [...lines].sort((a, b) => a - b);
}

function isOldStructuralLine(
  tr: Transaction,
  line: number,
  flat: HeadingNode[],
): boolean {
  if (line < 1 || line > tr.startState.doc.lines) {
    return false;
  }
  if (flat.some((h) => h.line === line || h.headingEndLine === line)) {
    return true;
  }
  return looksLikeHeadingOrFenceLine(tr.startState.doc.line(line).text);
}

export function classifyHeadingRebuild(
  tr: Transaction,
  value: FoldFieldValue,
): RebuildStrategy {
  if (!tr.docChanged) {
    return "reuse";
  }

  const newLines = touchedLines(tr);
  const oldLines = oldTouchedLines(tr);
  if (newLines.length === 0 && oldLines.length === 0) {
    return "reuse";
  }

  for (const line of newLines) {
    if (isStructuralLine(tr, line, value.flat)) {
      return "full";
    }
  }
  for (const line of oldLines) {
    if (isOldStructuralLine(tr, line, value.flat)) {
      return "full";
    }
  }

  if (changeInsertsNewline(tr) || tr.startState.doc.lines !== tr.state.doc.lines) {
    return "remap";
  }

  // Single-line body edits that do not create heading/fence syntax.
  return "reuse";
}

function computeField(
  state: EditorState,
  collapsedKeys: Set<string>,
  roots?: HeadingNode[],
  flat?: HeadingNode[],
): FoldFieldValue {
  const nextRoots = roots ?? buildHeadingTreeFromDoc(state.doc);
  const nextFlat = flat ?? flattenHeadingTree(nextRoots);
  const { decorations, headingLines } = buildDecorations(
    state,
    nextRoots,
    nextFlat,
    collapsedKeys,
  );
  return {
    collapsedKeys,
    roots: nextRoots,
    flat: nextFlat,
    decorations,
    headingLines,
  };
}

export const headingFoldField = StateField.define<FoldFieldValue>({
  create(state) {
    const roots = buildHeadingTreeFromDoc(state.doc);
    const flat = flattenHeadingTree(roots);
    const collapsedKeys = defaultCollapsedKeys(roots, flat);
    return computeField(state, collapsedKeys, roots, flat);
  },
  update(value, tr) {
    let collapsedKeys = value.collapsedKeys;
    let forceInitial = false;

    for (const effect of tr.effects) {
      if (effect.is(resetHeadingFolds)) {
        forceInitial = effect.value;
      }
      if (effect.is(toggleHeadingFold)) {
        const line = effect.value;
        const heading = value.flat.find((h) => h.line === line);
        if (heading) {
          const key = pathKey(heading.path);
          const next = new Set(collapsedKeys);
          if (next.has(key)) {
            next.delete(key);
          } else {
            next.add(key);
          }
          collapsedKeys = next;
        }
      }
    }

    if (forceInitial) {
      const roots = buildHeadingTreeFromDoc(tr.state.doc);
      const flat = flattenHeadingTree(roots);
      collapsedKeys = defaultCollapsedKeys(roots, flat);
      return computeField(tr.state, collapsedKeys, roots, flat);
    }

    if (!tr.docChanged && tr.effects.length === 0) {
      return value;
    }

    if (!tr.docChanged) {
      return computeField(tr.state, collapsedKeys, value.roots, value.flat);
    }

    const strategy = classifyHeadingRebuild(tr, value);
    if (strategy === "reuse") {
      return computeField(tr.state, collapsedKeys, value.roots, value.flat);
    }

    if (strategy === "remap") {
      const remappedRoots = mapHeadingTreeLines(value.roots, (line) =>
        mapLineThroughTransaction(tr, line),
      );
      const remappedFlat = flattenHeadingTree(remappedRoots);
      const mapped = mapCollapsedThroughTransaction(
        collectCollapsedFromFlat(value.flat, collapsedKeys),
        tr,
      );
      collapsedKeys = reconcileCollapsed(
        mapped,
        remappedRoots,
        remappedFlat,
        false,
      );
      return computeField(tr.state, collapsedKeys, remappedRoots, remappedFlat);
    }

    const mapped = mapCollapsedThroughTransaction(
      collectCollapsedFromFlat(value.flat, collapsedKeys),
      tr,
    );
    const roots = buildHeadingTreeFromDoc(tr.state.doc);
    const flat = flattenHeadingTree(roots);
    collapsedKeys = reconcileCollapsed(mapped, roots, flat, false);
    return computeField(tr.state, collapsedKeys, roots, flat);
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

const foldGutterMarker = gutter({
  class: "cm-heading-fold-gutter",
  markers: (view) => {
    const value = view.state.field(headingFoldField);
    const builder = new RangeSetBuilder<GutterMarker>();
    const lines = [...value.headingLines.entries()].sort((a, b) => a[0] - b[0]);
    for (const [line, collapsed] of lines) {
      if (line < 1 || line > view.state.doc.lines) {
        continue;
      }
      const lineObj = view.state.doc.line(line);
      builder.add(lineObj.from, lineObj.from, new FoldMarker(collapsed));
    }
    return builder.finish();
  },
  lineMarkerChange: (update) =>
    update.startState.field(headingFoldField) !== update.state.field(headingFoldField),
  domEventHandlers: {
    click: (view, block) => {
      const line = lineNumberAt(view, block);
      const value = view.state.field(headingFoldField);
      if (!value.headingLines.has(line)) {
        return false;
      }
      view.dispatch({
        effects: toggleHeadingFold.of(line),
      });
      return true;
    },
  },
});

export function headingFoldExtensions() {
  return [headingFoldField, foldGutterMarker];
}

/** Apply default heading folds (first-child chain expanded; others collapsed). */
export function collapseAllHeadingsEffect() {
  return resetHeadingFolds.of(true);
}
