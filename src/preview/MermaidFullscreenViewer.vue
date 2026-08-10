<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { trapFocus } from "@/shared/focusTrap";
import {
  createMermaidViewportState,
  fitMermaidViewport,
  mermaidViewportStageStyle,
  panMermaidViewport,
  parseSvgNaturalSize,
  resetMermaidViewport,
  resizeMermaidViewport,
  zoomMermaidViewport,
  zoomMermaidViewportIn,
  zoomMermaidViewportOut,
  type MermaidViewportState,
} from "@/preview/useMermaidViewport";

const props = defineProps<{
  open: boolean;
  title?: string;
  svgHtml: string;
  exportBusy?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "export-png": [];
  "export-svg": [];
  "copy-source": [];
  "copy-image": [];
}>();

const dialogRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const state = ref<MermaidViewportState | null>(null);
const dragging = ref(false);
let disposeTrap: (() => void) | null = null;
let lastX = 0;
let lastY = 0;
let resizeObserver: ResizeObserver | null = null;

const titleText = computed(() => props.title || "Mermaid 图表");
const scalePercent = computed(() =>
  state.value ? Math.round(state.value.scale * 100) : 100,
);
const stageStyle = computed(() =>
  state.value
    ? mermaidViewportStageStyle(state.value)
    : { width: "0px", height: "0px", transform: "none" },
);

function measureAndInit() {
  const viewport = viewportRef.value;
  if (!viewport || !props.open) {
    return;
  }
  const natural = parseSvgNaturalSize(props.svgHtml);
  const rect = viewport.getBoundingClientRect();
  state.value = createMermaidViewportState(natural, {
    width: rect.width,
    height: rect.height,
  });
}

function onKeydown(event: KeyboardEvent) {
  if (!props.open) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }
  if (!state.value) {
    return;
  }
  if (event.key === "+" || event.key === "=") {
    event.preventDefault();
    state.value = zoomMermaidViewportIn(state.value);
  } else if (event.key === "-" || event.key === "_") {
    event.preventDefault();
    state.value = zoomMermaidViewportOut(state.value);
  } else if (event.key === "0") {
    event.preventDefault();
    state.value = fitMermaidViewport(state.value);
  }
}

function onWheel(event: WheelEvent) {
  if (!state.value || !(event.ctrlKey || event.metaKey)) {
    return;
  }
  event.preventDefault();
  const viewport = viewportRef.value;
  if (!viewport) {
    return;
  }
  const rect = viewport.getBoundingClientRect();
  const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
  state.value = zoomMermaidViewport(state.value, factor, {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  });
}

function onPointerDown(event: PointerEvent) {
  if (!state.value || event.button !== 0) {
    return;
  }
  dragging.value = true;
  lastX = event.clientX;
  lastY = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value || !state.value) {
    return;
  }
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;
  lastX = event.clientX;
  lastY = event.clientY;
  state.value = panMermaidViewport(state.value, dx, dy);
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) {
    return;
  }
  dragging.value = false;
  try {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  } catch {
    // ignore
  }
}

function onFit() {
  if (state.value) {
    state.value = fitMermaidViewport(state.value);
  }
}

function onReset() {
  if (state.value) {
    state.value = resetMermaidViewport(state.value);
  }
}

function onZoomIn() {
  if (state.value) {
    state.value = zoomMermaidViewportIn(state.value);
  }
}

function onZoomOut() {
  if (state.value) {
    state.value = zoomMermaidViewportOut(state.value);
  }
}

watch(
  () => props.open,
  async (open) => {
    disposeTrap?.();
    disposeTrap = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    dragging.value = false;
    if (!open) {
      state.value = null;
      window.removeEventListener("keydown", onKeydown, true);
      return;
    }
    await nextTick();
    measureAndInit();
    if (dialogRef.value) {
      disposeTrap = trapFocus(dialogRef.value);
    }
    window.addEventListener("keydown", onKeydown, true);
    if (viewportRef.value && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (!state.value || !viewportRef.value) {
          return;
        }
        const rect = viewportRef.value.getBoundingClientRect();
        state.value = resizeMermaidViewport(state.value, {
          width: rect.width,
          height: rect.height,
        });
      });
      resizeObserver.observe(viewportRef.value);
    }
  },
  { immediate: true },
);

watch(
  () => props.svgHtml,
  () => {
    if (props.open) {
      measureAndInit();
    }
  },
);

onBeforeUnmount(() => {
  disposeTrap?.();
  disposeTrap = null;
  resizeObserver?.disconnect();
  window.removeEventListener("keydown", onKeydown, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="mermaid-viewer-overlay"
      data-testid="mermaid-fullscreen-viewer"
      @click.self="emit('close')"
    >
      <div
        ref="dialogRef"
        class="mermaid-viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="titleText"
        tabindex="-1"
      >
        <header class="mermaid-viewer-header">
          <h2 class="mermaid-viewer-title">{{ titleText }}</h2>
          <div class="mermaid-viewer-actions">
            <button type="button" data-testid="mermaid-viewer-fit" @click="onFit">
              适配
            </button>
            <button
              type="button"
              data-testid="mermaid-viewer-reset"
              @click="onReset"
            >
              100%
            </button>
            <button
              type="button"
              data-testid="mermaid-viewer-zoom-out"
              @click="onZoomOut"
            >
              −
            </button>
            <span class="mermaid-viewer-scale" aria-live="polite">
              {{ scalePercent }}%
            </span>
            <button
              type="button"
              data-testid="mermaid-viewer-zoom-in"
              @click="onZoomIn"
            >
              +
            </button>
            <button
              type="button"
              data-testid="mermaid-viewer-copy-source"
              :disabled="exportBusy"
              @click="emit('copy-source')"
            >
              复制源码
            </button>
            <button
              type="button"
              data-testid="mermaid-viewer-copy-image"
              :disabled="exportBusy"
              @click="emit('copy-image')"
            >
              复制图片
            </button>
            <button
              type="button"
              data-testid="mermaid-viewer-export-svg"
              :disabled="exportBusy"
              @click="emit('export-svg')"
            >
              SVG
            </button>
            <button
              type="button"
              data-testid="mermaid-viewer-export"
              :disabled="exportBusy"
              @click="emit('export-png')"
            >
              PNG
            </button>
            <button
              type="button"
              class="mermaid-viewer-close"
              data-testid="mermaid-viewer-close"
              aria-label="关闭"
              @click="emit('close')"
            >
              ×
            </button>
          </div>
        </header>
        <div
          ref="viewportRef"
          class="mermaid-viewer-viewport"
          :class="{ grabbing: dragging }"
          aria-label="图表视图，可拖拽平移"
          @wheel="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div
            class="mermaid-viewer-stage"
            :style="stageStyle"
            v-html="svgHtml"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mermaid-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 75;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.55);
}

.mermaid-viewer {
  display: grid;
  grid-template-rows: auto 1fr;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.35);
  overflow: hidden;
  outline: none;
}

.mermaid-viewer-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #f8fafc;
}

.mermaid-viewer-title {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  color: #111827;
}

.mermaid-viewer-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.mermaid-viewer-actions button {
  min-width: 36px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  color: #111827;
  font-size: 13px;
  cursor: pointer;
}

.mermaid-viewer-actions button:hover,
.mermaid-viewer-actions button:focus-visible {
  border-color: #93c5fd;
  background: #eff6ff;
  outline: none;
}

.mermaid-viewer-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.mermaid-viewer-close {
  font-size: 18px;
  line-height: 1;
}

.mermaid-viewer-scale {
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #4b5563;
}

.mermaid-viewer-viewport {
  position: relative;
  overflow: hidden;
  background: #f3f4f6;
  touch-action: none;
  cursor: grab;
}

.mermaid-viewer-viewport.grabbing {
  cursor: grabbing;
}

.mermaid-viewer-stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  pointer-events: none;
}

/* Fill the zoomed box so the browser re-rasters SVG at the display size. */
.mermaid-viewer-stage :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
}

@media (prefers-reduced-motion: reduce) {
  .mermaid-viewer-stage {
    transition: none;
  }
}
</style>
