import { EditorState, Plugin, TextSelection, Selection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import type { EditableProjection } from "@/markdown/buildEditableProjection";
import { isLocateModifier } from "@/shared/locateModifier";
import { isSafeLinkHref } from "@/shared/previewFormatting";
import type { PreviewFormatSelection } from "@/shared/previewFormatting";
import { editablePreviewSchema } from "./schema";
import {
  createReadonlyBlockNodeView,
  isEditableMermaidPending,
  waitForEditableMermaidReady,
} from "./mermaidNodeView";
import { createReadonlyInlineNodeView } from "./imageNodeView";
import {
  resolveEditableFormatSelection,
  sourceLineAtPosition,
} from "./resolveEditableSelection";
import { resolvePointerCaret } from "./resolvePointerCaret";
import type { TaskCheckboxToggleRequest } from "./taskCheckboxToggle";

export type PreviewEditStatusKind =
  | "editing"
  | "read-only"
  | "rejected"
  | "stale"
  | "info";

export interface PreviewEditStatus {
  readonly kind: PreviewEditStatusKind;
  readonly message: string;
}

export interface PreviewEditSessionHandlers {
  onStatus?: (status: PreviewEditStatus) => void;
  onSelectionChange?: (selection: PreviewFormatSelection | null) => void;
  onLocateSource?: (sourceLine: number) => void;
  onOpenLink?: (url: string) => void;
  onToggleTaskCheckbox?: (request: TaskCheckboxToggleRequest) => void;
  /** Current CodeMirror revision used for optimistic locking. */
  getRevision: () => number;
}

export interface PreviewEditSession {
  readonly view: EditorView;
  rebuild: (
    projection: EditableProjection,
    options?: { selection?: { anchor: number; head: number } | null },
  ) => void;
  getFormatSelection: () => PreviewFormatSelection | null;
  syncDomSelection: () => PreviewFormatSelection | null;
  setSourceSelection: (anchor: number, head: number) => boolean;
  scrollToSourceLine: (sourceLine: number) => Promise<void>;
  focus: () => void;
  blur: () => void;
  destroy: () => void;
}

/**
 * Exact source-offset → PM position mapping. No fuzzy ±N snapping — that
 * pulls the caret onto Markdown delimiters after rebuild.
 */
function selectionFromSourceOffsets(
  projection: EditableProjection,
  anchor: number,
  head: number,
): TextSelection | null {
  const mapSourceToPm = (offset: number): number | null => {
    for (const segment of projection.sourceMap.segments) {
      if (segment.policy !== "editable") {
        continue;
      }
      for (let index = 0; index < segment.sourceOffsets.length; index += 1) {
        if (segment.sourceOffsets[index] === offset) {
          return segment.pmFrom + index;
        }
      }
    }
    const empty = projection.sourceMap.blocks.find(
      (block) =>
        block.policy === "editable" &&
        block.contentPmFrom === block.contentPmTo &&
        block.contentSourceFrom === offset,
    );
    return empty ? empty.contentPmFrom : null;
  };
  const pmAnchor = mapSourceToPm(anchor);
  const pmHead = mapSourceToPm(head);
  if (pmAnchor == null || pmHead == null) {
    return null;
  }
  try {
    return TextSelection.create(projection.doc, pmAnchor, pmHead);
  } catch {
    return null;
  }
}

function selectionNearBlock(
  projection: EditableProjection,
  preferredBlockId: string | null,
  fallbackSourceLine: number | null,
  relativeContentOffset: number | null = null,
): Selection {
  const placeInBlock = (block: {
    contentPmFrom: number;
    contentPmTo: number;
  }): Selection | null => {
    try {
      const span = Math.max(0, block.contentPmTo - block.contentPmFrom);
      const offset =
        relativeContentOffset == null
          ? span
          : Math.max(0, Math.min(span, relativeContentOffset));
      const pos = block.contentPmFrom + offset;
      return TextSelection.create(projection.doc, pos, pos);
    } catch {
      return null;
    }
  };

  if (preferredBlockId) {
    const held = projection.sourceMap.blocks.find(
      (block) => block.id === preferredBlockId,
    );
    if (held) {
      if (held.contentPmFrom === held.contentPmTo) {
        try {
          return TextSelection.create(
            projection.doc,
            held.contentPmFrom,
            held.contentPmFrom,
          );
        } catch {
          // fall through
        }
      }
      const placed = placeInBlock(held);
      if (placed) {
        return placed;
      }
    }
  }
  if (fallbackSourceLine != null) {
    const byLine = projection.sourceMap.blocks
      .filter(
        (block) =>
          block.policy === "editable" &&
          block.sourceLine <= fallbackSourceLine,
      )
      .sort((a, b) => b.sourceLine - a.sourceLine)[0];
    if (byLine) {
      const placed = placeInBlock(byLine);
      if (placed) {
        return placed;
      }
    }
  }
  const size = projection.doc.content.size;
  try {
    return TextSelection.near(
      projection.doc.resolve(Math.max(0, Math.min(size, size))),
    ) as Selection;
  } catch {
    return TextSelection.near(projection.doc.resolve(0)) as Selection;
  }
}

/**
 * Write a native DOM selection for a ProseMirror TextSelection.
 * Required when the preview is non-editable: PM will not call selectionToDOM
 * unless a native selection already owns the preview DOM.
 */
function applyNativeSelection(view: EditorView, selection: Selection): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const anchor = view.domAtPos(selection.anchor);
    const head = view.domAtPos(selection.head);
    const domSelection = window.getSelection();
    if (!domSelection) {
      return false;
    }
    domSelection.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      head.node,
      head.offset,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Mount a history-free, non-editable ProseMirror view used for selection,
 * format toolbar mapping, Mermaid node views, and locate — not typing.
 */
export function createPreviewEditSession(
  parent: HTMLElement,
  initialProjection: EditableProjection,
  handlers: PreviewEditSessionHandlers,
): PreviewEditSession {
  let projection = initialProjection;
  let destroyed = false;
  let applyingExternal = false;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let publishSelectionToken = 0;
  let blankPointerDrag:
    | {
        root: Document | ShadowRoot;
        move: EventListener;
        up: EventListener;
      }
    | null = null;

  const readFormatSelection = (allowNativeExactFallback = false) =>
    resolveEditableFormatSelection(view, projection, {
      revision: handlers.getRevision(),
      allowNativeExactFallback,
    });

  /** Publish a pure-read snapshot. Never rewrites Selection / PM state. */
  const emitSelection = (allowNativeExactFallback = false) => {
    handlers.onSelectionChange?.(readFormatSelection(allowNativeExactFallback));
  };

  /**
   * After a pointer gesture settles, publish once more with the controlled
   * native exact fallback. Still never mutates the visual selection.
   */
  const scheduleSettledSelectionPublish = () => {
    const token = ++publishSelectionToken;
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        if (destroyed || token !== publishSelectionToken) {
          return;
        }
        emitSelection(true);
      });
    });
  };

  const finishBlankPointerDrag = (publish = true) => {
    const active = blankPointerDrag;
    if (!active) {
      return;
    }
    blankPointerDrag = null;
    active.root.removeEventListener("mousemove", active.move, true);
    active.root.removeEventListener("mouseup", active.up, true);
    if (publish) {
      scheduleSettledSelectionPublish();
    }
  };

  const beginBlankPointerDrag = (anchor: number) => {
    finishBlankPointerDrag(false);
    const root = view.root;
    const move: EventListener = (rawEvent) => {
      if (!(rawEvent instanceof MouseEvent)) {
        return;
      }
      if (rawEvent.buttons === 0) {
        finishBlankPointerDrag();
        return;
      }
      rawEvent.preventDefault();
      const blank = resolvePointerCaret(
        view,
        rawEvent.clientX,
        rawEvent.clientY,
      );
      const hit =
        blank ??
        view.posAtCoords({
          left: rawEvent.clientX,
          top: rawEvent.clientY,
        });
      if (!hit) {
        return;
      }
      const head = Math.max(
        0,
        Math.min(hit.pos, view.state.doc.content.size),
      );
      let selection: Selection;
      try {
        selection = TextSelection.between(
          view.state.doc.resolve(anchor),
          view.state.doc.resolve(head),
        );
      } catch {
        return;
      }
      if (
        selection.anchor === view.state.selection.anchor &&
        selection.head === view.state.selection.head
      ) {
        return;
      }
      // Non-editable PM will not push state.selection to the DOM; write native
      // first so DOMObserver can sync PM state from the browser selection.
      applyNativeSelection(view, selection);
      applyingExternal = true;
      view.dispatch(
        view.state.tr.setSelection(selection).scrollIntoView(),
      );
      applyingExternal = false;
    };
    const up: EventListener = (rawEvent) => {
      if (rawEvent instanceof MouseEvent && rawEvent.button !== 0) {
        return;
      }
      finishBlankPointerDrag();
    };
    blankPointerDrag = { root, move, up };
    root.addEventListener("mousemove", move, true);
    root.addEventListener("mouseup", up, true);
  };

  const plugins = [
    new Plugin({
      props: {
        attributes: {
          class: "ProseMirror tm-editable-preview markdown-body",
          role: "document",
          "aria-label": "Markdown 预览",
        },
        handleDrop() {
          return true;
        },
        handleDOMEvents: {
          mousedown(view, event) {
            if (
              !(event instanceof MouseEvent) ||
              event.button !== 0 ||
              event.shiftKey ||
              event.detail > 1 ||
              isLocateModifier(event) ||
              !(event.target instanceof Element) ||
              event.target.closest("a[href], [data-tm-readonly]")
            ) {
              return false;
            }
            const resolved = resolvePointerCaret(
              view,
              event.clientX,
              event.clientY,
            );
            if (!resolved?.blank) {
              return false;
            }
            event.preventDefault();
            const selection = TextSelection.create(
              view.state.doc,
              resolved.pos,
            );
            applyNativeSelection(view, selection);
            if (
              !view.state.selection.empty ||
              view.state.selection.head !== resolved.pos
            ) {
              applyingExternal = true;
              view.dispatch(view.state.tr.setSelection(selection));
              applyingExternal = false;
            }
            beginBlankPointerDrag(resolved.pos);
            return true;
          },
          dragstart(_view, event) {
            event.preventDefault();
            return true;
          },
          copy(view, event) {
            // Prefer native highlighted text when PM's selection is still skewed.
            if (!(event instanceof ClipboardEvent) || !event.clipboardData) {
              return false;
            }
            const native = window.getSelection()?.toString() ?? "";
            if (!native) {
              return false;
            }
            const pmText = view.state.selection.empty
              ? ""
              : view.state.doc.textBetween(
                  view.state.selection.from,
                  view.state.selection.to,
                );
            if (pmText === native) {
              return false;
            }
            event.clipboardData.setData("text/plain", native);
            event.preventDefault();
            return true;
          },
          cut() {
            // Cut would mutate content; block it in the non-editable preview.
            return true;
          },
          mouseup() {
            // Drag/click gesture finished — publish a settled snapshot without
            // mutating the browser or ProseMirror selection.
            scheduleSettledSelectionPublish();
            return false;
          },
          click(view, event) {
            if (!(event.target instanceof Element)) {
              return false;
            }
            if (isLocateModifier(event)) {
              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              if (!pos) {
                return false;
              }
              const line = sourceLineAtPosition(projection, pos.pos);
              if (line != null) {
                event.preventDefault();
                handlers.onLocateSource?.(line);
                return true;
              }
              return false;
            }

            const link = event.target.closest("a[href]");
            if (link instanceof HTMLAnchorElement) {
              const rawHref = link.getAttribute("href")?.trim() ?? "";
              if (rawHref.startsWith("#")) {
                return false;
              }
              event.preventDefault();
              // Plain / Alt+click open safe links via system opener.
              // Link-label caret editing is deferred to direct-typing WP.
              if (isSafeLinkHref(link.href)) {
                handlers.onOpenLink?.(link.href);
              }
              return true;
            }

            const checkbox = event.target.closest(
              ".tm-readonly-task-checkbox",
            );
            if (checkbox instanceof HTMLElement) {
              const from = Number(checkbox.getAttribute("data-tm-from"));
              const to = Number(checkbox.getAttribute("data-tm-to"));
              if (
                Number.isSafeInteger(from) &&
                Number.isSafeInteger(to) &&
                to > from
              ) {
                const expectedText = projection.sourceMap.source.slice(
                  from,
                  to,
                );
                event.preventDefault();
                handlers.onToggleTaskCheckbox?.({
                  from,
                  to,
                  expectedText,
                  revision: handlers.getRevision(),
                });
                return true;
              }
            }

            const readonly = event.target.closest("[data-tm-readonly]");
            if (readonly) {
              handlers.onStatus?.({
                kind: "read-only",
                message: "该内容暂不支持在预览中编辑，请改用源码区",
              });
            }
            return false;
          },
          contextmenu(_view, event) {
            if (isLocateModifier(event as MouseEvent)) {
              event.preventDefault();
              return true;
            }
            return false;
          },
        },
        editable() {
          return false;
        },
      },
    }),
  ];

  const view = new EditorView(parent, {
    state: EditorState.create({
      schema: editablePreviewSchema,
      doc: projection.doc,
      plugins,
    }),
    nodeViews: {
      readonly_block: createReadonlyBlockNodeView,
      readonly_inline: createReadonlyInlineNodeView,
    },
    dispatchTransaction(tr) {
      if (destroyed) {
        return;
      }
      // Selection-only updates. Document mutations are ignored because the
      // preview is non-editable and no longer translates typing to source.
      if (tr.docChanged && !applyingExternal) {
        return;
      }
      view.updateState(view.state.apply(tr));
      emitSelection();
    },
  });

  function rebuild(
    next: EditableProjection,
    options?: { selection?: { anchor: number; head: number } | null },
  ) {
    if (destroyed) {
      return;
    }
    const previousHead = Math.min(
      view.state.selection.head,
      view.state.doc.content.size,
    );
    const previousBlock = projection.sourceMap.blockAt(previousHead);
    const relativeContentOffset = previousBlock
      ? Math.max(0, previousHead - previousBlock.contentPmFrom)
      : null;
    projection = next;
    let nextSelection: Selection | undefined;
    if (options?.selection != null) {
      nextSelection =
        selectionFromSourceOffsets(
          next,
          options.selection.anchor,
          options.selection.head,
        ) ?? undefined;
      if (!nextSelection) {
        nextSelection = selectionNearBlock(
          next,
          previousBlock?.id ?? null,
          previousBlock?.sourceLine ?? null,
          0,
        );
      }
    }
    if (!nextSelection) {
      nextSelection = selectionNearBlock(
        next,
        previousBlock?.id ?? null,
        previousBlock?.sourceLine ?? null,
        relativeContentOffset,
      );
    }
    applyingExternal = true;
    view.updateState(
      EditorState.create({
        schema: editablePreviewSchema,
        doc: next.doc,
        plugins,
        selection: nextSelection,
      }),
    );
    applyingExternal = false;
    if (nextSelection && !nextSelection.empty) {
      applyNativeSelection(view, nextSelection);
    }
    emitSelection();
  }

  function getFormatSelection(): PreviewFormatSelection | null {
    return readFormatSelection(true);
  }

  /** Pure read of the current format snapshot; never rewrites Selection. */
  function syncDomSelection(): PreviewFormatSelection | null {
    return getFormatSelection();
  }

  function setSourceSelection(anchor: number, head: number): boolean {
    const mapped = selectionFromSourceOffsets(projection, anchor, head);
    if (!mapped) {
      return false;
    }
    // Non-editable roots cannot take focus; write the native selection so
    // DOMObserver can own and sync it into PM state.
    if (!applyNativeSelection(view, mapped)) {
      return false;
    }
    applyingExternal = true;
    view.dispatch(view.state.tr.setSelection(mapped));
    applyingExternal = false;
    emitSelection();
    return true;
  }

  async function scrollToSourceLine(sourceLine: number) {
    // Mermaid NodeViews mount SVG asynchronously; wait so scroll targets the
    // final diagram height instead of the label placeholder. Re-await a few
    // times in case a rebuild starts while we are waiting.
    for (let i = 0; i < 5; i += 1) {
      await waitForEditableMermaidReady();
      if (!isEditableMermaidPending()) {
        break;
      }
    }
    const blocks = projection.sourceMap.blocks
      .filter((block) => block.sourceLine <= sourceLine)
      .sort((a, b) => b.sourceLine - a.sourceLine);
    const target =
      blocks[0] ??
      projection.sourceMap.blocks
        .slice()
        .sort((a, b) => a.sourceLine - b.sourceLine)[0];
    if (!target) {
      return;
    }
    const dom = view.nodeDOM(target.pmFrom);
    const el =
      dom instanceof HTMLElement
        ? dom
        : dom?.parentElement instanceof HTMLElement
          ? dom.parentElement
          : null;
    if (!el) {
      return;
    }
    parent
      .querySelectorAll(".preview-flash")
      .forEach((node) => node.classList.remove("preview-flash"));
    el.classList.add("preview-flash");
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (flashTimer) {
      clearTimeout(flashTimer);
    }
    flashTimer = setTimeout(() => {
      flashTimer = null;
      el.classList.remove("preview-flash");
    }, 1200);
  }

  return {
    view,
    rebuild,
    getFormatSelection,
    syncDomSelection,
    setSourceSelection,
    scrollToSourceLine,
    focus: () => {
      // Non-editable roots reject focus; no-op is intentional.
    },
    blur: () => view.dom.blur(),
    destroy: () => {
      destroyed = true;
      publishSelectionToken += 1;
      finishBlankPointerDrag(false);
      if (flashTimer) {
        clearTimeout(flashTimer);
      }
      view.destroy();
    },
  };
}
