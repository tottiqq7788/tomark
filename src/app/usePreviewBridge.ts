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

  async function ensureMarkdown() {
    if (!renderMarkdownFn) {
      const module = await import("@/markdown/renderMarkdown");
      renderMarkdownFn = module.renderMarkdown;
    }
    return renderMarkdownFn;
  }

  async function renderPreview(source: string) {
    const version = ++previewVersion;
    const renderMarkdown = await ensureMarkdown();
    if (version !== previewVersion) {
      return;
    }
    const result = renderMarkdown(source);
    if (version !== previewVersion) {
      return;
    }
    html.value = result.html;
    lineToAnchor.value = result.lineToAnchor;
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

  async function locate(line: number) {
    refreshPreview.cancel();
    await renderPreview(content.value);
    await nextTick();
    await previewRef.value?.scrollToSourceLine(line);
  }

  return {
    previewRef,
    html,
    lineToAnchor,
    locate,
    renderPreview,
    refreshPreview,
  };
}
