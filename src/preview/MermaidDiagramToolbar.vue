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
  "copy-source": [];
  "export-svg": [];
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
      class="mermaid-btn mermaid-btn-label"
      title="Export SVG"
      aria-label="Export SVG"
      data-testid="mermaid-export-svg"
      :disabled="busy"
      :aria-busy="busy ? 'true' : 'false'"
      @mousedown="retainSelection"
      @click="emit('export-svg')"
    >
      SVG
    </button>
    <button
      type="button"
      class="mermaid-btn mermaid-btn-label"
      title="Export PNG"
      aria-label="Export PNG"
      data-testid="mermaid-export-png"
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

.mermaid-btn-label {
  width: auto;
  min-width: 36px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
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
