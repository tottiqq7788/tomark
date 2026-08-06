import { computed, ref } from "vue";

export type ViewMode = "source" | "split" | "preview";

const VIEW_MODE_ORDER: ViewMode[] = ["split", "source", "preview"];

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  source: "源码",
  split: "源码/渲染",
  preview: "渲染",
};

export function nextViewMode(mode: ViewMode): ViewMode {
  const index = VIEW_MODE_ORDER.indexOf(mode);
  const safeIndex = index < 0 ? 0 : index;
  return VIEW_MODE_ORDER[(safeIndex + 1) % VIEW_MODE_ORDER.length];
}

export function viewModeLabel(mode: ViewMode): string {
  return VIEW_MODE_LABELS[mode];
}

export function useViewMode(initial: ViewMode = "split") {
  const mode = ref<ViewMode>(initial);

  const label = computed(() => viewModeLabel(mode.value));
  const isSourceVisible = computed(
    () => mode.value === "source" || mode.value === "split",
  );
  const isPreviewVisible = computed(
    () => mode.value === "preview" || mode.value === "split",
  );
  const showSplitter = computed(() => mode.value === "split");

  function cycle() {
    mode.value = nextViewMode(mode.value);
  }

  return {
    mode,
    label,
    isSourceVisible,
    isPreviewVisible,
    showSplitter,
    cycle,
  };
}
