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
  max-width: min(120px, calc(100vw - 16px));
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
