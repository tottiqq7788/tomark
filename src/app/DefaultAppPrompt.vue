<script setup lang="ts">
defineProps<{
  open: boolean;
  busy?: boolean;
  platformHint: string;
  statusMessage?: string;
}>();

const emit = defineEmits<{
  later: [];
  confirm: [];
}>();
</script>

<template>
  <div
    v-if="open"
    class="default-app-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="default-app-title"
    data-testid="default-app-prompt"
  >
    <div class="default-app-card">
      <h2 id="default-app-title">设置 Markdown 默认打开方式</h2>
      <p>
        tomark 已可打开 <code>.md</code> / <code>.markdown</code> 文件。建议将其设为系统默认应用，之后双击即可直接编辑。
      </p>
      <p class="hint">{{ platformHint }}</p>
      <p v-if="statusMessage" class="status" role="status">{{ statusMessage }}</p>
      <div class="actions">
        <button
          type="button"
          class="btn-secondary"
          data-testid="default-app-later"
          :disabled="busy"
          @click="emit('later')"
        >
          稍后
        </button>
        <button
          type="button"
          class="btn-primary"
          data-testid="default-app-confirm"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ busy ? "处理中…" : "设为默认" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.default-app-overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.42);
}

.default-app-card {
  width: min(440px, 100%);
  padding: 20px 22px 18px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 22px 56px rgba(15, 23, 42, 0.24);
  color: #111827;
}

.default-app-card h2 {
  margin: 0 0 10px;
  font-size: 16px;
  font-weight: 650;
}

.default-app-card p {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.55;
  color: #374151;
}

.default-app-card code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 4px;
  background: #f3f4f6;
}

.hint {
  color: #6b7280 !important;
}

.status {
  color: #1d4ed8 !important;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

.btn-secondary,
.btn-primary {
  min-width: 84px;
  height: 32px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.btn-secondary {
  border: 1px solid #d1d5db;
  background: #fff;
  color: #374151;
}

.btn-primary {
  border: 1px solid #2563eb;
  background: #2563eb;
  color: #fff;
}

.btn-secondary:disabled,
.btn-primary:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
