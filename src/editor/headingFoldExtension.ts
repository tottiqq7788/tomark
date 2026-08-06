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
  buildHeadingTree,
  flattenHeadingTree,
  pathKey,
  type HeadingNode,
} from "./headingTree";

export interface CollapsedHeading {
  key: string;
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

function collectCollapsedFromTree(
  roots: HeadingNode[],
  collapsedKeys: Set<string>,
): CollapsedHeading[] {
  const flat = flattenHeadingTree(roots);
  return flat
    .filter((h) => collapsedKeys.has(pathKey(h.path)))
    .map((h) => ({
      key: pathKey(h.path),
      level: h.level,
      text: h.text,
      line: h.line,
      bodyStart: h.bodyStart,
      bodyEndExclusive: h.bodyEndExclusive,
    }));
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
  roots: HeadingNode[],
  isInitial: boolean,
): Set<string> {
  const flat = flattenHeadingTree(roots);
  if (isInitial) {
    return new Set(flat.map((h) => pathKey(h.path)));
  }

  const next = new Set<string>();
  const usedPrev = new Set<number>();

  for (const heading of flat) {
    const key = pathKey(heading.path);
    let matched = prev.find(
      (p, idx) => !usedPrev.has(idx) && p.key === key,
    );
    if (!matched) {
      matched = prev.find(
        (p, idx) =>
          !usedPrev.has(idx) &&
          p.level === heading.level &&
          p.text === heading.text,
      );
    }
    if (!matched) {
      matched = prev.find(
        (p, idx) =>
          !usedPrev.has(idx) &&
          p.level === heading.level &&
          Math.abs(p.line - heading.line) <= 3,
      );
    }

    if (matched) {
      usedPrev.add(prev.indexOf(matched));
      next.add(key);
    }
  }

  return next;
}

interface FoldFieldValue {
  collapsedKeys: Set<string>;
  roots: HeadingNode[];
  decorations: ReturnType<typeof Decoration.set>;
  headingLines: Map<number, boolean>;
}

function buildDecorations(
  state: EditorState,
  roots: HeadingNode[],
  collapsedKeys: Set<string>,
): { decorations: ReturnType<typeof Decoration.set>; headingLines: Map<number, boolean> } {
  const ranges = visibleCollapsedRanges(roots, collapsedKeys);
  const widgets: { from: number; to: number }[] = [];
  const headingLines = new Map<number, boolean>();

  for (const h of flattenHeadingTree(roots)) {
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

function computeField(
  state: EditorState,
  collapsedKeys: Set<string>,
): FoldFieldValue {
  const source = state.doc.toString();
  const roots = buildHeadingTree(source);
  const { decorations, headingLines } = buildDecorations(
    state,
    roots,
    collapsedKeys,
  );
  return { collapsedKeys, roots, decorations, headingLines };
}

export const headingFoldField = StateField.define<FoldFieldValue>({
  create(state) {
    const roots = buildHeadingTree(state.doc.toString());
    const collapsedKeys = new Set(
      flattenHeadingTree(roots).map((h) => pathKey(h.path)),
    );
    return computeField(state, collapsedKeys);
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
        const heading = flattenHeadingTree(value.roots).find((h) => h.line === line);
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
      const roots = buildHeadingTree(tr.state.doc.toString());
      collapsedKeys = new Set(
        flattenHeadingTree(roots).map((h) => pathKey(h.path)),
      );
      return computeField(tr.state, collapsedKeys);
    }

    if (tr.docChanged || tr.effects.length > 0) {
      const mapped = mapCollapsedThroughTransaction(
        collectCollapsedFromTree(value.roots, collapsedKeys),
        tr,
      );
      const roots = buildHeadingTree(tr.state.doc.toString());
      collapsedKeys = reconcileCollapsed(mapped, roots, false);
      return computeField(tr.state, collapsedKeys);
    }

    return value;
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

export function collapseAllHeadingsEffect() {
  return resetHeadingFolds.of(true);
}
