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
  "export-png": [];
  "copy-source": [];
  "export-svg": [];
  locate: [];
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
    class="mermaid-toolbar"
    role="toolbar"
    aria-label="Mermaid 图表"
    :style="{ top: `${top}px`, left: `${centerX}px` }"
    data-testid="preview-mermaid-toolbar"
    @keydown="onToolbarKeydown"
  >
    <button
      type="button"
      class="mermaid-btn"
      title="全屏查看"
      aria-label="全屏查看"
      data-testid="mermaid-fullscreen"
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
      class="mermaid-btn"
      title="导出 PNG"
      aria-label="导出 PNG"
      data-testid="mermaid-export-png"
      :disabled="busy"
      :aria-busy="busy ? 'true' : 'false'"
      @mousedown="retainSelection"
      @click="emit('export-png')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 2.2a.75.75 0 0 1 .75.75V8.2l1.7-1.7a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3A.75.75 0 0 1 5.55 6.5L7.25 8.2V2.95A.75.75 0 0 1 8 2.2zM3 11.5A.75.75 0 0 1 3.75 10.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 11.5z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="mermaid-btn"
      title="导出 SVG"
      aria-label="导出 SVG"
      data-testid="mermaid-export-svg"
      :disabled="busy"
      :aria-busy="busy ? 'true' : 'false'"
      @mousedown="retainSelection"
      @click="emit('export-svg')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M3 3.75A.75.75 0 0 1 3.75 3h3.5a.75.75 0 0 1 0 1.5H5.56l2.22 2.22a.75.75 0 0 1-1.06 1.06L4.5 5.56v1.69a.75.75 0 0 1-1.5 0v-3.5zM12.25 3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0V5.56L9.28 7.78a.75.75 0 1 1-1.06-1.06L10.44 4.5H8.75a.75.75 0 0 1 0-1.5h3.5zM3.75 8.75a.75.75 0 0 1 .75.75v1.69l2.22-2.22a.75.75 0 1 1 1.06 1.06L5.56 12.25h1.69a.75.75 0 0 1 0 1.5h-3.5A.75.75 0 0 1 3 13.25v-3.5a.75.75 0 0 1 .75-.75zm8.5 0a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h1.69l-2.22-2.22a.75.75 0 1 1 1.06-1.06l2.22 2.22V9.5a.75.75 0 0 1 .75-.75z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="mermaid-btn"
      title="复制源码"
      aria-label="复制源码"
      data-testid="mermaid-copy-source"
      :disabled="busy"
      @mousedown="retainSelection"
      @click="emit('copy-source')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5.5 2.75A1.75 1.75 0 0 1 7.25 1h5A1.75 1.75 0 0 1 14 2.75v7A1.75 1.75 0 0 1 12.25 11.5h-.5a.75.75 0 0 1 0-1.5h.5a.25.25 0 0 0 .25-.25v-7a.25.25 0 0 0-.25-.25h-5a.25.25 0 0 0-.25.25V4a.75.75 0 0 1-1.5 0V2.75zM2 5.75A1.75 1.75 0 0 1 3.75 4h5A1.75 1.75 0 0 1 10.5 5.75v7A1.75 1.75 0 0 1 8.75 14.5h-5A1.75 1.75 0 0 1 2 12.75v-7zm1.75-.25a.25.25 0 0 0-.25.25v7c0 .138.112.25.25.25h5a.25.25 0 0 0 .25-.25v-7a.25.25 0 0 0-.25-.25h-5z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="mermaid-btn"
      title="定位源码"
      aria-label="定位源码"
      data-testid="mermaid-locate-source"
      :disabled="busy"
      @mousedown="retainSelection"
      @click="emit('locate')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 1.5a4.75 4.75 0 0 0-4.75 4.75c0 2.62 1.88 5.08 3.94 7.15a1.2 1.2 0 0 0 1.62 0c2.06-2.07 3.94-4.53 3.94-7.15A4.75 4.75 0 0 0 8 1.5zm0 6.5a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5z"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.mermaid-toolbar {
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

.mermaid-btn {
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

.mermaid-btn:hover,
.mermaid-btn:focus-visible {
  background: rgba(255, 255, 255, 0.12);
  outline: none;
}

.mermaid-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.mermaid-btn svg {
  width: 14px;
  height: 14px;
}
</style>
