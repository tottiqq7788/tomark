import { debounce } from "@/shared/debounce";
import type { PreviewAnchor, RenderResult } from "@/shared/types";
import {
  buildEditableProjection,
  type EditableProjection,
} from "@/markdown/buildEditableProjection";
import { parseMarkdownDocument } from "@/markdown/parseMarkdownDocument";
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";

type PreviewHandle = {
  scrollToSourceLine: (line: number) => Promise<void>;
  flushComposition?: () => void;
  isComposing?: () => boolean;
};

export type PreviewRenderMode = "editable" | "fallback";

export function usePreviewBridge(content: Ref<string>) {
  const previewRef = ref<PreviewHandle | null>(null);
  const html = ref("");
  const lineToAnchor = ref<Map<number, PreviewAnchor>>(new Map());
  const previewError = ref<string | null>(null);
  /** Source string that produced the current preview (null before first paint). */
  const renderedSource = ref<string | null>(null);
  const projection = ref<EditableProjection | null>(null);
  const renderMode = ref<PreviewRenderMode>("fallback");
  /** Increments whenever the editable host must rebuild from source. */
  const editableSyncToken = ref(0);
  const selectionRecovery = ref<{ anchor: number; head: number } | null>(null);

  let renderMarkdownFn: ((source: string) => RenderResult) | null = null;
  let previewVersion = 0;
  let pendingLocateLine: number | null = null;
  let locateGeneration = 0;
  /** Skip debounced full refresh while the preview owns the latest patch. */
  let ownEditDepth = 0;
  let composing = false;
  let paused = false;

  async function ensureMarkdown() {
    if (!renderMarkdownFn) {
      const module = await import("@/markdown/renderMarkdown");
      renderMarkdownFn = module.renderMarkdown;
    }
    return renderMarkdownFn;
  }

  function projectionBlockType(nodeType: string): string {
    switch (nodeType) {
      case "paragraph":
        return "p";
      case "heading":
        return "h1";
      case "bullet_list":
        return "ul";
      case "ordered_list":
        return "ol";
      case "list_item":
        return "li";
      case "blockquote":
        return "blockquote";
      case "table":
        return "table";
      case "table_row":
        return "tr";
      case "table_cell":
        return "td";
      case "table_header":
        return "th";
      case "readonly_block":
        return "pre";
      default:
        return nodeType;
    }
  }

  function buildLineAnchorsFromProjection(
    next: EditableProjection,
  ): Map<number, PreviewAnchor> {
    const map = new Map<number, PreviewAnchor>();
    for (const block of next.sourceMap.blocks) {
      let blockType = projectionBlockType(block.nodeType);
      if (block.nodeType === "heading" && block.context.heading) {
        blockType = `h${block.context.heading.level}`;
      }
      const anchor: PreviewAnchor = {
        id: block.id,
        sourceLineStart: block.sourceLine,
        sourceLineEnd: block.sourceEndLine,
        blockType,
      };
      for (
        let line = block.sourceLine;
        line <= Math.max(block.sourceLine, block.sourceEndLine);
        line += 1
      ) {
        if (!map.has(line)) {
          map.set(line, anchor);
        }
      }
    }
    return map;
  }

  function applyEditableProjection(
    source: string,
    options?: {
      selection?: { anchor: number; head: number } | null;
      bumpSync?: boolean;
    },
  ): boolean {
    try {
      const parsed = parseMarkdownDocument(source);
      const next = buildEditableProjection(parsed);
      projection.value = next;
      renderMode.value = "editable";
      lineToAnchor.value = buildLineAnchorsFromProjection(next);
      renderedSource.value = source;
      previewError.value = null;
      selectionRecovery.value = options?.selection ?? null;
      if (options?.bumpSync !== false) {
        editableSyncToken.value += 1;
      }
      return true;
    } catch (error) {
      projection.value = null;
      renderMode.value = "fallback";
      previewError.value =
        error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /** @returns false when a newer render superseded this one. */
  async function renderPreview(
    source: string,
    options?: {
      force?: boolean;
      selection?: { anchor: number; head: number } | null;
      preferEditable?: boolean;
    },
  ): Promise<boolean> {
    if (
      !options?.force &&
      source === renderedSource.value &&
      previewError.value === null &&
      (renderMode.value === "editable"
        ? projection.value != null
        : html.value.length > 0)
    ) {
      return true;
    }

    const version = ++previewVersion;
    try {
      if (source.length > 48_000) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (version !== previewVersion) {
          return false;
        }
      }

      const preferEditable = options?.preferEditable !== false;
      if (preferEditable) {
        const ok = applyEditableProjection(source, {
          selection: options?.selection,
          bumpSync: true,
        });
        if (version !== previewVersion) {
          return false;
        }
        if (ok) {
          // Keep a sanitized HTML snapshot for fallback / tests without blocking.
          void ensureMarkdown()
            .then((renderMarkdown) => {
              if (version !== previewVersion) {
                return;
              }
              try {
                const result = renderMarkdown(source);
                html.value = result.html;
              } catch {
                // Editable path already succeeded.
              }
            })
            .catch(() => undefined);
          return true;
        }
      }

      const renderMarkdown = await ensureMarkdown();
      if (version !== previewVersion) {
        return false;
      }
      const result = renderMarkdown(source);
      if (version !== previewVersion) {
        return false;
      }
      html.value = result.html;
      lineToAnchor.value = result.lineToAnchor;
      renderedSource.value = source;
      projection.value = null;
      renderMode.value = "fallback";
      previewError.value = null;
      return true;
    } catch (error) {
      if (version !== previewVersion) {
        return false;
      }
      const message =
        error instanceof Error ? error.message : String(error);
      previewError.value = message;
      html.value = `<p data-preview-error="1">预览渲染失败：${escapeHtml(message)}</p>`;
      lineToAnchor.value = new Map();
      renderedSource.value = source;
      projection.value = null;
      renderMode.value = "fallback";
      return false;
    }
  }

  const refreshPreview = debounce((source: string) => {
    if (ownEditDepth > 0 || composing || paused) {
      return;
    }
    void renderPreview(source);
  }, 200);

  watch(
    content,
    (value, previous) => {
      if (ownEditDepth > 0) {
        return;
      }
      if (composing || paused) {
        return;
      }
      const openedOrReplaced =
        previous === undefined ||
        previous.length === 0 ||
        Math.abs(value.length - previous.length) > 400;
      if (openedOrReplaced) {
        refreshPreview.cancel();
        void renderPreview(value, { force: true });
        return;
      }
      refreshPreview(value);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    refreshPreview.cancel();
  });

  async function syncNow(
    options?: { selection?: { anchor: number; head: number } | null },
  ): Promise<boolean> {
    refreshPreview.cancel();
    return renderPreview(content.value, {
      force: true,
      selection: options?.selection,
    });
  }

  function isCurrent(): boolean {
    return renderedSource.value === content.value;
  }

  async function flushPendingLocate() {
    if (pendingLocateLine === null || !previewRef.value) {
      return;
    }
    const line = pendingLocateLine;
    pendingLocateLine = null;
    await previewRef.value.scrollToSourceLine(line);
  }

  function attachPreview(handle: PreviewHandle | null) {
    previewRef.value = handle;
    if (handle) {
      void flushPendingLocate();
    }
  }

  async function locate(line: number) {
    const generation = ++locateGeneration;
    previewRef.value?.flushComposition?.();
    const ok = await syncNow();
    if (!ok || generation !== locateGeneration) {
      return;
    }
    await nextTick();
    if (generation !== locateGeneration) {
      return;
    }
    if (previewRef.value) {
      pendingLocateLine = null;
      await previewRef.value.scrollToSourceLine(line);
    } else {
      pendingLocateLine = line;
    }
  }

  function beginOwnEdit() {
    ownEditDepth += 1;
    refreshPreview.cancel();
  }

  function endOwnEdit() {
    ownEditDepth = Math.max(0, ownEditDepth - 1);
  }

  /** Apply a projection rebuild without treating content as an external change. */
  function syncAfterOwnEdit(
    source: string,
    selection?: { anchor: number; head: number } | null,
    options?: { bumpSync?: boolean },
  ) {
    beginOwnEdit();
    try {
      applyEditableProjection(source, {
        selection,
        // Typing already adopted the projection inside the PM session; bumping
        // would rebuild the host and risk snapping the caret to a block start.
        bumpSync: options?.bumpSync !== false,
      });
    } finally {
      endOwnEdit();
    }
  }

  function setComposing(next: boolean) {
    composing = next;
    if (!next && ownEditDepth === 0 && !paused) {
      refreshPreview(content.value);
    }
  }

  function setPaused(next: boolean) {
    paused = next;
    if (!next && ownEditDepth === 0 && !composing) {
      void renderPreview(content.value, { force: true });
    }
  }

  async function flushEditSession(): Promise<void> {
    previewRef.value?.flushComposition?.();
    refreshPreview.cancel();
    if (!isCurrent()) {
      await renderPreview(content.value, { force: true });
    }
  }

  /** Sync IME flush for shortcuts / menus that must not await a rebuild. */
  function flushCompositionOnly(): void {
    previewRef.value?.flushComposition?.();
  }

  return {
    previewRef,
    html,
    lineToAnchor,
    previewError,
    renderedSource,
    projection,
    renderMode,
    editableSyncToken,
    selectionRecovery,
    locate,
    syncNow,
    isCurrent,
    attachPreview,
    renderPreview,
    refreshPreview,
    beginOwnEdit,
    endOwnEdit,
    syncAfterOwnEdit,
    setComposing,
    setPaused,
    flushEditSession,
    flushCompositionOnly,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
