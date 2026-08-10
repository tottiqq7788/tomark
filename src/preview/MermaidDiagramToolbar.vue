<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  visible: boolean;
  top: number;
  centerX: number;
  busy?: boolean;
  editable?: boolean;
}>();

const root = ref<HTMLElement | null>(null);

const emit = defineEmits<{
  edit: [];
  fullscreen: [];
  "copy-source": [];
  "copy-image": [];
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
      v-if="editable"
      type="button"
      class="mermaid-btn"
      title="可视化编辑"
      aria-label="可视化编辑"
      data-testid="mermaid-edit"
      :disabled="busy"
      @mousedown="retainSelection"
      @click="emit('edit')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.752.453l-3.251 1.023a.75.75 0 0 1-.935-.935l1.023-3.251a1.75 1.75 0 0 1 .453-.752l8.61-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.823 3.74l1.437 1.437 1.25-1.25a.25.25 0 0 0 0-.354l-1.083-1.086zM9.763 4.8l-6.38 6.38a.25.25 0 0 0-.065.108l-.688 2.187 2.187-.688a.25.25 0 0 0 .108-.065l6.38-6.38L9.763 4.8z"
        />
      </svg>
    </button>
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
      class="mermaid-btn"
      title="复制图片"
      aria-label="复制图片"
      data-testid="mermaid-copy-image"
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
  max-width: min(300px, calc(100vw - 16px));
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
