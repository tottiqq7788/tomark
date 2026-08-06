<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message: string;
}>();

const emit = defineEmits<{
  save: [];
  discard: [];
  cancel: [];
}>();
</script>

<template>
  <div v-if="open" class="overlay" role="dialog" aria-modal="true">
    <div class="dialog">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <div class="actions">
        <button type="button" class="primary" @click="emit('save')">保存</button>
        <button type="button" @click="emit('discard')">不保存</button>
        <button type="button" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: grid;
  place-items: center;
  z-index: 50;
}

.dialog {
  width: min(420px, calc(100vw - 32px));
  background: #fff;
  border-radius: 12px;
  padding: 18px 18px 14px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
}

h2 {
  margin: 0 0 8px;
  font-size: 16px;
}

p {
  margin: 0 0 16px;
  color: #4b5563;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

button {
  border: 1px solid #d1d5db;
  background: #fff;
  border-radius: 8px;
  padding: 6px 12px;
  cursor: pointer;
}

button.primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

button:hover {
  filter: brightness(0.97);
}
</style>
