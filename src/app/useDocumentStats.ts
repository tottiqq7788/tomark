import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  ref,
  watch,
  type Ref,
} from "vue";
import { debounce } from "@/shared/debounce";
import {
  computeDocumentStats,
  formatDocumentStats,
  type DocumentStats,
} from "@/shared/documentStats";

const DEFAULT_DEBOUNCE_MS = 120;
/** Above this size, stats updates are debounced to avoid typing jank. */
const DEFAULT_LARGE_DOC_CHARS = 8_000;

export function useDocumentStats(
  content: Ref<string>,
  options?: {
    debounceMs?: number;
    largeDocChars?: number;
  },
) {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const largeDocChars = options?.largeDocChars ?? DEFAULT_LARGE_DOC_CHARS;

  const stats = ref<DocumentStats>(computeDocumentStats(content.value));
  const label = computed(() => formatDocumentStats(stats.value));

  function apply(source: string) {
    stats.value = computeDocumentStats(source);
  }

  const applyDebounced = debounce(apply, debounceMs);

  watch(content, (source) => {
    if (source.length >= largeDocChars) {
      applyDebounced(source);
      return;
    }
    applyDebounced.cancel();
    apply(source);
  });

  function flush() {
    applyDebounced.cancel();
    apply(content.value);
  }

  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      applyDebounced.cancel();
    });
  }

  return {
    stats,
    label,
    flush,
  };
}
