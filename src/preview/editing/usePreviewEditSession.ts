import { baseKeymap, chainCommands, exitCode } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, Plugin, TextSelection, Selection, type Transaction } from "prosemirror-state";
import { goToNextCell } from "prosemirror-tables";
import { EditorView } from "prosemirror-view";
import {
  buildEditableProjection,
  type EditableProjection,
} from "@/markdown/buildEditableProjection";
import type {
  ApplySourceTransactionResult,
  PreviewEditOrigin,
  SourcePatchTransaction,
  SourceSelectionRecovery,
} from "@/shared/previewEditing";
import { isLocateModifier } from "@/shared/locateModifier";
import { isSafeLinkHref } from "@/shared/previewFormatting";
import type { PreviewFormatSelection } from "@/shared/previewFormatting";
import {
  structureCommandToSourcePatches,
  transactionToSourcePatches,
  type PatchTranslationFailureReason,
} from "./transactionToSourcePatches";
import { editablePreviewSchema } from "./schema";
import {
  resolveEditableFormatSelection,
  sourceLineAtPosition,
} from "./resolveEditableSelection";
import { resolvePointerCaret } from "./resolvePointerCaret";

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
  applySourceTransaction: (
    transaction: SourcePatchTransaction,
  ) => ApplySourceTransactionResult;
  onStatus?: (status: PreviewEditStatus) => void;
  onSelectionChange?: (selection: PreviewFormatSelection | null) => void;
  onComposingChange?: (composing: boolean) => void;
  onLocateSource?: (sourceLine: number) => void;
  onOpenLink?: (url: string) => void;
  /** Current CodeMirror revision used for optimistic locking. */
  getRevision: () => number;
}

export interface PreviewEditSession {
  readonly view: EditorView;
  isComposing: () => boolean;
  flushComposition: () => void;
  rebuild: (
    projection: EditableProjection,
    options?: { selection?: { anchor: number; head: number } | null },
  ) => void;
  getFormatSelection: () => PreviewFormatSelection | null;
  syncDomSelection: () => PreviewFormatSelection | null;
  setSourceSelection: (anchor: number, head: number) => boolean;
  scrollToSourceLine: (sourceLine: number) => Promise<void>;
  focus: () => void;
  destroy: () => void;
}

function statusForFailure(
  reason: PatchTranslationFailureReason | string,
): PreviewEditStatus {
  switch (reason) {
    case "read-only":
      return {
        kind: "read-only",
        message: "该内容暂不支持在预览中编辑，请改用源码区",
      };
    case "table-structure-read-only":
      return {
        kind: "rejected",
        message: "表格单元格暂不支持换行，请在源码区调整表格结构",
      };
    case "cross-block-edit":
    case "incompatible-blocks":
    case "unsupported-structure":
    case "structural-command-required":
    case "mixed-edit-context":
      return {
        kind: "rejected",
        message: "该操作暂不支持在预览中完成，请改用源码区",
      };
    case "stale-projection":
    case "stale-revision":
      return {
        kind: "stale",
        message: "映射已过期，已重新同步",
      };
    default:
      return {
        kind: "rejected",
        message: "无法应用到源码，请改用源码区编辑",
      };
  }
}

function findDiffRange(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): { from: number; to: number; insertFrom: number; insertTo: number } | null {
  const start = before.content.findDiffStart(after.content);
  if (start == null) {
    return null;
  }
  const end = before.content.findDiffEnd(after.content);
  if (!end) {
    return {
      from: start,
      to: before.content.size,
      insertFrom: start,
      insertTo: after.content.size,
    };
  }
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return { from: start, to: endA, insertFrom: start, insertTo: endB };
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
): Selection {
  if (preferredBlockId) {
    const held = projection.sourceMap.blocks.find(
      (block) => block.id === preferredBlockId,
    );
    if (held) {
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
      try {
        return TextSelection.create(
          projection.doc,
          byLine.contentPmFrom,
          byLine.contentPmFrom,
        );
      } catch {
        // fall through
      }
    }
  }
  return TextSelection.near(projection.doc.resolve(0)) as Selection;
}

/**
 * Mount a history-free ProseMirror view that commits only local Markdown patches.
 */
export function createPreviewEditSession(
  parent: HTMLElement,
  initialProjection: EditableProjection,
  handlers: PreviewEditSessionHandlers,
): PreviewEditSession {
  let projection = initialProjection;
  let composing = false;
  let compositionBase: ProseMirrorNode | null = null;
  let compositionRevision: number | null = null;
  let destroyed = false;
  let applyingExternal = false;
  /** Hold an empty editable paragraph that would otherwise collapse on rebuild. */
  let heldEmptyBlockId: string | null = null;
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
      view.dispatch(
        view.state.tr.setSelection(selection).scrollIntoView(),
      );
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

  const acceptProjection = (
    next: EditableProjection,
    selection?: SourceSelectionRecovery | null,
  ) => {
    const previousHead = Math.min(
      view.state.selection.head,
      view.state.doc.content.size,
    );
    const previousBlock = projection.sourceMap.blockAt(previousHead);
    projection = next;
    let nextSelection: Selection | undefined;
    if (selection) {
      nextSelection =
        selectionFromSourceOffsets(next, selection.anchor, selection.head) ??
        undefined;
    }
    if (!nextSelection && heldEmptyBlockId) {
      nextSelection = selectionNearBlock(next, heldEmptyBlockId, null);
    }
    if (!nextSelection) {
      nextSelection = selectionNearBlock(
        next,
        previousBlock?.id ?? null,
        previousBlock?.sourceLine ?? null,
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
  };

  const commitSourceTransaction = (
    transaction: SourcePatchTransaction,
  ): boolean => {
    const result = handlers.applySourceTransaction(transaction);
    if (!result.ok) {
      handlers.onStatus?.(statusForFailure(result.reason));
      return false;
    }
    // Immediately adopt the post-patch projection so the next keystroke does
    // not translate against a stale source map while Vue's syncToken catches up.
    try {
      const next = buildEditableProjection(result.value);
      // Typing/composition/paste already applied an optimistic PM doc. When the
      // rebuilt tree matches, keep that document node and only correct the caret
      // from the source selection — remapping via block-start would snap away.
      const keepOptimisticDoc =
        heldEmptyBlockId == null &&
        view.state.doc.eq(next.doc) &&
        (transaction.origin === "typing" ||
          transaction.origin === "composition" ||
          transaction.origin === "paste");
      if (keepOptimisticDoc) {
        projection = next;
        if (transaction.selection) {
          const mapped = selectionFromSourceOffsets(
            next,
            transaction.selection.anchor,
            transaction.selection.head,
          );
          if (
            mapped &&
            (mapped.anchor !== view.state.selection.anchor ||
              mapped.head !== view.state.selection.head)
          ) {
            applyingExternal = true;
            view.updateState(view.state.apply(view.state.tr.setSelection(mapped)));
            applyingExternal = false;
          }
        }
      } else {
        acceptProjection(next, transaction.selection ?? null);
      }
    } catch {
      // Bridge already updated source; Vue rebuild will reconcile.
    }
    heldEmptyBlockId = null;
    handlers.onStatus?.({
      kind: "editing",
      message: "正在预览中编辑",
    });
    return true;
  };

  const revertToProjection = (preferredHead?: number) => {
    applyingExternal = true;
    const head = Math.min(
      preferredHead ?? view.state.selection.head,
      projection.doc.content.size,
    );
    const block = projection.sourceMap.blockAt(head);
    view.updateState(
      EditorState.create({
        schema: editablePreviewSchema,
        doc: projection.doc,
        plugins,
        selection: selectionNearBlock(
          projection,
          block?.id ?? null,
          block?.sourceLine ?? null,
        ),
      }),
    );
    applyingExternal = false;
  };

  const commitStructure = (
    type: "split-block" | "join-backward" | "join-forward",
  ): boolean => {
    // compositionend settles via microtask; structure keys must flush first so
    // Enter/Backspace never translate against a projection that omits composed text.
    if (composing || view.composing) {
      finishComposition();
    }
    const translated = structureCommandToSourcePatches({
      projection,
      command: { type, pmPosition: view.state.selection.head },
      revision: handlers.getRevision(),
    });
    if (!translated.ok) {
      handlers.onStatus?.(statusForFailure(translated.reason));
      return true;
    }
    return commitSourceTransaction(translated.sourceTransaction);
  };

  const translateAndCommit = (
    tr: Transaction,
    origin: Exclude<PreviewEditOrigin, "structure">,
  ): boolean => {
    if (!tr.before.eq(projection.doc)) {
      handlers.onStatus?.(statusForFailure("stale-projection"));
      return false;
    }
    const translated = transactionToSourcePatches({
      projection,
      transaction: tr,
      revision: handlers.getRevision(),
      origin,
    });
    if (!translated.ok) {
      handlers.onStatus?.(statusForFailure(translated.reason));
      return false;
    }
    return commitSourceTransaction(translated.sourceTransaction);
  };

  const finishComposition = () => {
    if (!compositionBase) {
      composing = false;
      compositionRevision = null;
      handlers.onComposingChange?.(false);
      return;
    }
    const base = compositionBase;
    const baseRevision = compositionRevision;
    compositionBase = null;
    compositionRevision = null;
    composing = false;
    handlers.onComposingChange?.(false);

    if (
      baseRevision != null &&
      baseRevision !== handlers.getRevision()
    ) {
      handlers.onStatus?.(statusForFailure("stale-revision"));
      revertToProjection();
      emitSelection();
      return;
    }

    const diff = findDiffRange(base, view.state.doc);
    if (!diff) {
      return;
    }
    // Translate against the composition base, which must still match the
    // session projection used when composition started.
    if (!base.eq(projection.doc)) {
      handlers.onStatus?.(statusForFailure("stale-projection"));
      revertToProjection();
      emitSelection();
      return;
    }
    const tr = EditorState.create({
      schema: editablePreviewSchema,
      doc: base,
    }).tr.replace(
      diff.from,
      diff.to,
      view.state.doc.slice(diff.insertFrom, diff.insertTo),
    );
    if (!translateAndCommit(tr, "composition")) {
      revertToProjection();
      emitSelection();
    }
  };

  const plugins = [
    keymap({
      Enter: () => commitStructure("split-block"),
      "Shift-Enter": exitCode,
      Backspace: chainCommands((state, dispatch) => {
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset > 0) {
          return false;
        }
        if (dispatch) {
          commitStructure("join-backward");
        }
        return true;
      }),
      Delete: chainCommands((state, dispatch) => {
        const { $from, empty } = state.selection;
        if (!empty || $from.parentOffset < $from.parent.content.size) {
          return false;
        }
        if (dispatch) {
          commitStructure("join-forward");
        }
        return true;
      }),
      Tab: goToNextCell(1),
      "Shift-Tab": goToNextCell(-1),
    }),
    keymap(baseKeymap),
    new Plugin({
      props: {
        attributes: {
          class: "ProseMirror tm-editable-preview markdown-body",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": "可编辑 Markdown 预览",
        },
        handlePaste(_view, event) {
          event.preventDefault();
          const text = event.clipboardData?.getData("text/plain") ?? "";
          if (!text) {
            return true;
          }
          if (/[\r\n]/.test(text)) {
            const block = projection.sourceMap.blockAt(
              view.state.selection.head,
            );
            if (block?.context.tableCell) {
              handlers.onStatus?.(statusForFailure("table-structure-read-only"));
              return true;
            }
            handlers.onStatus?.({
              kind: "rejected",
              message: "多行粘贴暂请在源码区完成",
            });
            return true;
          }
          const { from, to } = view.state.selection;
          const tr = view.state.tr.insertText(text, from, to);
          if (!translateAndCommit(tr, "paste")) {
            // Paste was not applied optimistically to the view.
          }
          return true;
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
            if (!view.hasFocus()) {
              view.focus();
            }
            if (
              !view.state.selection.empty ||
              view.state.selection.head !== resolved.pos
            ) {
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, resolved.pos),
                ),
              );
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
            return false;
          },
          compositionstart() {
            composing = true;
            compositionBase = view.state.doc;
            compositionRevision = handlers.getRevision();
            handlers.onComposingChange?.(true);
            return false;
          },
          compositionend() {
            // Allow ProseMirror to settle the composed characters first.
            queueMicrotask(() => {
              if (!destroyed) {
                finishComposition();
              }
            });
            return false;
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
              if (event.altKey && isSafeLinkHref(link.href)) {
                handlers.onOpenLink?.(link.href);
                return true;
              }
              // Plain click places the caret for label editing.
              return false;
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
          return true;
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
    dispatchTransaction(tr) {
      if (destroyed) {
        return;
      }
      if (applyingExternal) {
        view.updateState(view.state.apply(tr));
        emitSelection();
        return;
      }

      if (!tr.docChanged) {
        view.updateState(view.state.apply(tr));
        emitSelection();
        return;
      }

      if (composing || view.composing) {
        composing = true;
        if (!compositionBase) {
          // WebKit may skip compositionstart — never fall back to a possibly
          // stale projection.doc; use the live view document instead.
          compositionBase = view.state.doc;
          compositionRevision = handlers.getRevision();
          handlers.onComposingChange?.(true);
        }
        view.updateState(view.state.apply(tr));
        return;
      }

      // Translate against the current projection before mutating the view so a
      // rejected transaction never leaves an optimistic desync.
      const origin: Exclude<PreviewEditOrigin, "structure"> =
        tr.getMeta("uiEvent") === "paste" ? "paste" : "typing";

      if (!tr.before.eq(projection.doc)) {
        handlers.onStatus?.(statusForFailure("stale-projection"));
        // Do not roll back an already-committed previous keystroke — refuse this
        // one and ask the host to force-resync (status kind "stale").
        return;
      }

      const translated = transactionToSourcePatches({
        projection,
        transaction: tr,
        revision: handlers.getRevision(),
        origin,
      });
      if (!translated.ok) {
        handlers.onStatus?.(statusForFailure(translated.reason));
        return;
      }

      const nextState = view.state.apply(tr);
      view.updateState(nextState);

      const block = projection.sourceMap.blockAt(tr.selection.head);
      if (
        block &&
        block.policy === "editable" &&
        nextState.doc.textBetween(block.contentPmFrom, block.contentPmTo) === ""
      ) {
        heldEmptyBlockId = block.id;
      }

      if (!commitSourceTransaction(translated.sourceTransaction)) {
        revertToProjection(tr.selection.head);
      }
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
    if (composing) {
      // External change during composition: discard temporary input.
      compositionBase = null;
      compositionRevision = null;
      composing = false;
      handlers.onComposingChange?.(false);
      handlers.onStatus?.({
        kind: "stale",
        message: "映射已过期，已重新同步",
      });
    }
    const previousBlock = projection.sourceMap.blockAt(
      Math.min(view.state.selection.head, view.state.doc.content.size),
    );
    projection = next;
    let nextSelection: Selection | undefined;
    if (options?.selection != null) {
      nextSelection =
        selectionFromSourceOffsets(
          next,
          options.selection.anchor,
          options.selection.head,
        ) ?? undefined;
    }
    if (!nextSelection && heldEmptyBlockId) {
      nextSelection = selectionNearBlock(next, heldEmptyBlockId, null);
    }
    if (!nextSelection) {
      nextSelection = selectionNearBlock(
        next,
        previousBlock?.id ?? null,
        previousBlock?.sourceLine ?? null,
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
    emitSelection();
  }

  function flushComposition() {
    if (composing || view.composing) {
      finishComposition();
    }
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
    applyingExternal = true;
    view.dispatch(view.state.tr.setSelection(mapped));
    applyingExternal = false;
    view.focus();
    emitSelection();
    return true;
  }

  async function scrollToSourceLine(sourceLine: number) {
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
    isComposing: () => composing || view.composing,
    flushComposition,
    rebuild,
    getFormatSelection,
    syncDomSelection,
    setSourceSelection,
    scrollToSourceLine,
    focus: () => view.focus(),
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
