<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  visible: boolean;
  top: number;
  centerX: number;
  busy?: boolean;
}>();

const root = ref<HTMLElement | null>(null);

const emit = defineEmits<{
  fullscreen: [];
  "copy-image": [];
  "export-png": [];
  dismiss: [];
}>();

defineExpose({ root });

function retainSelection(event: MouseEvent) {
  event.preventDefault();
}

function onToolbarKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("dismiss");
  }
}
</script>

<template>
  <div
    ref="root"
    v-show="visible"
    class="image-toolbar"
    role="toolbar"
    aria-label="图片"
    :style="{ top: `${top}px`, left: `${centerX}px` }"
    data-testid="preview-image-toolbar"
    @keydown="onToolbarKeydown"
  >
    <button
      type="button"
      class="image-btn"
      title="全屏查看"
      aria-label="全屏查看"
      data-testid="image-fullscreen"
      :disabled="busy"
      @mousedown="retainSelection"
      @click="emit('fullscreen')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M2 2h4v1.5H3.5V6H2V2zm8 0h4v4h-1.5V3.5H10V2zM2 10h1.5v2.5H6V14H2v-4zm8 2.5H12.5V10H14v4h-4v-1.5z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="image-btn"
      title="复制图片"
      aria-label="复制图片"
      data-testid="image-copy-image"
      :disabled="busy"
      :aria-busy="busy ? 'true' : 'false'"
      @mousedown="retainSelection"
      @click="emit('copy-image')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M2.75 2.5A1.75 1.75 0 0 0 1 4.25v7.5c0 .966.784 1.75 1.75 1.75h10.5A1.75 1.75 0 0 0 15 11.75v-7.5A1.75 1.75 0 0 0 13.25 2.5H2.75zM2.5 4.25c0-.138.112-.25.25-.25h10.5c.138 0 .25.112.25.25v5.19l-2.22-2.22a.75.75 0 0 0-1.06 0L6.5 11l-1.47-1.47a.75.75 0 0 0-1.06 0L2.5 11.5V4.25zm8.25 1.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="image-btn image-btn-label"
      title="Export PNG"
      aria-label="Export PNG"
      data-testid="image-export-png"
      :disabled="busy"
      :aria-busy="busy ? 'true' : 'false'"
      @mousedown="retainSelection"
      @click="emit('export-png')"
    >
      PNG
    </button>
  </div>
</template>

<style scoped>
.image-toolbar {
  position: fixed;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  max-width: min(220px, calc(100vw - 16px));
  transform: translateX(-50%);
  background: #111827;
  color: #f9fafb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28);
}

.image-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.image-btn-label {
  width: auto;
  min-width: 36px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}

.image-btn:hover,
.image-btn:focus-visible {
  background: rgba(255, 255, 255, 0.12);
  outline: none;
}

.image-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.image-btn svg {
  width: 14px;
  height: 14px;
}
</style>
