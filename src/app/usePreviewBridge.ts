import { debounce } from "@/shared/debounce";
import type { PreviewAnchor, RenderResult } from "@/shared/types";
import { nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";

type PreviewHandle = {
  scrollToSourceLine: (line: number) => Promise<void>;
};

export function usePreviewBridge(content: Ref<string>) {
  const previewRef = ref<PreviewHandle | null>(null);
  const html = ref("");
  const lineToAnchor = ref<Map<number, PreviewAnchor>>(new Map());
  const previewError = ref<string | null>(null);
  /** Source string that produced the current `html` (null before first paint). */
  const renderedSource = ref<string | null>(null);
  let renderMarkdownFn: ((source: string) => RenderResult) | null = null;
  let previewVersion = 0;
  let pendingLocateLine: number | null = null;
  let locateGeneration = 0;

  async function ensureMarkdown() {
    if (!renderMarkdownFn) {
      const module = await import("@/markdown/renderMarkdown");
      renderMarkdownFn = module.renderMarkdown;
    }
    return renderMarkdownFn;
  }

  /** @returns false when a newer render superseded this one. */
  async function renderPreview(
    source: string,
    options?: { force?: boolean },
  ): Promise<boolean> {
    if (
      !options?.force &&
      source === renderedSource.value &&
      previewError.value === null &&
      html.value.length > 0
    ) {
      return true;
    }

    const version = ++previewVersion;
    try {
      // Yield one frame for large docs so the UI can paint before parsing.
      if (source.length > 48_000) {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (version !== previewVersion) {
          return false;
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
      return false;
    }
  }

  const refreshPreview = debounce((source: string) => {
    void renderPreview(source);
  }, 200);

  watch(
    content,
    (value, previous) => {
      // File open / replace: paint immediately. Typing stays debounced.
      const openedOrReplaced =
        previous === undefined ||
        previous.length === 0 ||
        Math.abs(value.length - previous.length) > 400;
      if (openedOrReplaced) {
        refreshPreview.cancel();
        void renderPreview(value);
        return;
      }
      refreshPreview(value);
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    refreshPreview.cancel();
  });

  /** Cancel debounce and render current content immediately. */
  async function syncNow(): Promise<boolean> {
    refreshPreview.cancel();
    return renderPreview(content.value);
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
    const ok = await syncNow();
    // Newer locate/render won the race — do not scroll with stale anchors.
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

  return {
    previewRef,
    html,
    lineToAnchor,
    previewError,
    renderedSource,
    locate,
    syncNow,
    isCurrent,
    attachPreview,
    renderPreview,
    refreshPreview,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
