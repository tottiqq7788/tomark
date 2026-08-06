import { computed, onBeforeUnmount, ref, type Ref } from "vue";

export const DEFAULT_EDITOR_RATIO = 1 / 3;
export const MIN_PANE_RATIO = 0.18;
export const MAX_EDITOR_RATIO = 1 - MIN_PANE_RATIO;

export function clampEditorRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_EDITOR_RATIO;
  }
  return Math.min(MAX_EDITOR_RATIO, Math.max(MIN_PANE_RATIO, ratio));
}

export function usePaneSplit(options?: {
  initialRatio?: number;
  containerRef?: Ref<HTMLElement | null>;
}) {
  const containerRef = options?.containerRef ?? ref<HTMLElement | null>(null);
  const editorRatio = ref(
    clampEditorRatio(options?.initialRatio ?? DEFAULT_EDITOR_RATIO),
  );
  const dragging = ref(false);

  const gridTemplateColumns = computed(
    () =>
      `minmax(0, ${editorRatio.value}fr) 6px minmax(0, ${1 - editorRatio.value}fr)`,
  );

  function setRatioFromClientX(clientX: number) {
    const el = containerRef.value;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }
    editorRatio.value = clampEditorRatio((clientX - rect.left) / rect.width);
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging.value) {
      return;
    }
    event.preventDefault();
    setRatioFromClientX(event.clientX);
  }

  function stopDragging() {
    if (!dragging.value) {
      return;
    }
    dragging.value = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDragging);
    window.removeEventListener("pointercancel", stopDragging);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  }

  function startDragging(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragging.value = true;
    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      target.setPointerCapture(event.pointerId);
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    setRatioFromClientX(event.clientX);
  }

  function nudgeRatio(delta: number) {
    editorRatio.value = clampEditorRatio(editorRatio.value + delta);
  }

  onBeforeUnmount(stopDragging);

  return {
    containerRef,
    editorRatio,
    dragging,
    gridTemplateColumns,
    startDragging,
    stopDragging,
    nudgeRatio,
    setRatioFromClientX,
  };
}
