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
  let renderMarkdownFn: ((source: string) => RenderResult) | null = null;
  let previewVersion = 0;
  let pendingLocateLine: number | null = null;

  async function ensureMarkdown() {
    if (!renderMarkdownFn) {
      const module = await import("@/markdown/renderMarkdown");
      renderMarkdownFn = module.renderMarkdown;
    }
    return renderMarkdownFn;
  }

  /** @returns false when a newer render superseded this one. */
  async function renderPreview(source: string): Promise<boolean> {
    const version = ++previewVersion;
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
    return true;
  }

  const refreshPreview = debounce((source: string) => {
    void renderPreview(source);
  }, 200);

  watch(
    content,
    (value) => {
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
    const ok = await syncNow();
    // Newer locate/render won the race — do not scroll with stale anchors.
    if (!ok) {
      return;
    }
    await nextTick();
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
    locate,
    syncNow,
    attachPreview,
    renderPreview,
    refreshPreview,
  };
}
