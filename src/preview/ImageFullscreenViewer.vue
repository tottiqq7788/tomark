<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { trapFocus } from "@/shared/focusTrap";
import {
  createMermaidViewportState,
  fitMermaidViewport,
  mermaidViewportStageStyle,
  panMermaidViewport,
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
  imageSrc: string;
  naturalWidth: number;
  naturalHeight: number;
  exportBusy?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "export-png": [];
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

const titleText = computed(() => props.title || "图片");
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
  const natural = {
    width: Math.max(1, props.naturalWidth || 1),
    height: Math.max(1, props.naturalHeight || 1),
  };
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
    window.removeEventListener("keydown", onKeydown, true);
    if (!open) {
      state.value = null;
      dragging.value = false;
      return;
    }
    await nextTick();
    measureAndInit();
    const dialog = dialogRef.value;
    if (dialog) {
      disposeTrap = trapFocus(dialog);
      dialog.focus();
    }
    window.addEventListener("keydown", onKeydown, true);
    const viewport = viewportRef.value;
    if (viewport && typeof ResizeObserver !== "undefined") {
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
      resizeObserver.observe(viewport);
    }
  },
);

watch(
  () => [props.imageSrc, props.naturalWidth, props.naturalHeight] as const,
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
      class="image-viewer-overlay"
      data-testid="image-fullscreen-viewer"
      @click.self="emit('close')"
    >
      <div
        ref="dialogRef"
        class="image-viewer"
        role="dialog"
        aria-modal="true"
        :aria-label="titleText"
        tabindex="-1"
      >
        <header class="image-viewer-header">
          <h2 class="image-viewer-title">{{ titleText }}</h2>
          <div class="image-viewer-actions">
            <button type="button" data-testid="image-viewer-fit" @click="onFit">
              适配
            </button>
            <button
              type="button"
              data-testid="image-viewer-reset"
              @click="onReset"
            >
              100%
            </button>
            <button
              type="button"
              data-testid="image-viewer-zoom-out"
              @click="onZoomOut"
            >
              −
            </button>
            <span class="image-viewer-scale" aria-live="polite">
              {{ scalePercent }}%
            </span>
            <button
              type="button"
              data-testid="image-viewer-zoom-in"
              @click="onZoomIn"
            >
              +
            </button>
            <button
              type="button"
              data-testid="image-viewer-copy-image"
              :disabled="exportBusy"
              @click="emit('copy-image')"
            >
              复制图片
            </button>
            <button
              type="button"
              data-testid="image-viewer-export"
              :disabled="exportBusy"
              @click="emit('export-png')"
            >
              PNG
            </button>
            <button
              type="button"
              class="image-viewer-close"
              data-testid="image-viewer-close"
              aria-label="关闭"
              @click="emit('close')"
            >
              ×
            </button>
          </div>
        </header>
        <div
          ref="viewportRef"
          class="image-viewer-viewport"
          :class="{ grabbing: dragging }"
          aria-label="图片视图，可拖拽平移"
          @wheel="onWheel"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div class="image-viewer-stage" :style="stageStyle">
            <img
              class="image-viewer-img"
              :src="imageSrc"
              alt=""
              draggable="false"
            />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.image-viewer-overlay {
  position: fixed;
  inset: 0;
  z-index: 75;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.55);
}

.image-viewer {
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

.image-viewer-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #e5e7eb;
  background: #f8fafc;
}

.image-viewer-title {
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  color: #111827;
}

.image-viewer-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.image-viewer-actions button {
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

.image-viewer-actions button:hover,
.image-viewer-actions button:focus-visible {
  border-color: #93c5fd;
  background: #eff6ff;
  outline: none;
}

.image-viewer-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}

.image-viewer-close {
  font-size: 18px;
  line-height: 1;
}

.image-viewer-scale {
  min-width: 48px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: #4b5563;
}

.image-viewer-viewport {
  position: relative;
  overflow: hidden;
  background: #f3f4f6;
  touch-action: none;
  cursor: grab;
}

.image-viewer-viewport.grabbing {
  cursor: grabbing;
}

.image-viewer-stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  pointer-events: none;
}

.image-viewer-img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  object-fit: contain;
}
</style>
