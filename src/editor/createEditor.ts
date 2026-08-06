import {
  EditorState,
  Compartment,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  drawSelection,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import {
  collapseAllHeadingsEffect,
  headingFoldExtensions,
} from "./headingFoldExtension";
import { locateGutter, type LocateHandler } from "./locateGutter";

export interface CreateEditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange: (value: string) => void;
  onLocate: LocateHandler;
  extensions?: Extension[];
}

export interface EditorHandle {
  view: EditorView;
  setDocument: (doc: string, options?: { collapseHeadings?: boolean }) => void;
  getValue: () => string;
  destroy: () => void;
}

export function createEditor(options: CreateEditorOptions): EditorHandle {
  const readOnly = new Compartment();

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      options.onChange(update.state.doc.toString());
    }
  });

  const theme = EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "14px",
    },
    ".cm-scroller": {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      lineHeight: "1.55",
    },
    ".cm-content": {
      padding: "12px 0",
    },
    ".cm-heading-fold-gutter": {
      width: "16px",
    },
    ".cm-heading-fold-marker": {
      border: "none",
      background: "transparent",
      cursor: "pointer",
      color: "#4b5563",
      fontSize: "12px",
      padding: "0 2px",
      lineHeight: "1",
    },
    ".cm-heading-fold-marker:hover": {
      color: "#111827",
    },
    ".cm-gutters": {
      backgroundColor: "#f8fafc",
      borderRight: "1px solid #e5e7eb",
      color: "#9ca3af",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#eef2ff",
    },
  });

  const startState = EditorState.create({
    doc: options.doc,
    extensions: [
      lineNumbers(),
      ...headingFoldExtensions(),
      ...locateGutter(options.onLocate),
      drawSelection(),
      highlightActiveLine(),
      history(),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      updateListener,
      theme,
      readOnly.of([]),
      ...(options.extensions ?? []),
    ],
  });

  const view = new EditorView({
    state: startState,
    parent: options.parent,
  });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    setDocument: (doc, opts) => {
      const effects =
        opts?.collapseHeadings === false ? [] : [collapseAllHeadingsEffect()];
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: doc,
        },
        effects,
      });
    },
    destroy: () => view.destroy(),
  };
}
