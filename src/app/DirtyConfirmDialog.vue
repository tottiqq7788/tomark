<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  save: [];
  discard: [];
  cancel: [];
}>();

const saveButton = ref<HTMLButtonElement | null>(null);
const discardButton = ref<HTMLButtonElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
let previouslyFocused: HTMLElement | null = null;
let listening = false;

function focusableButtons(): HTMLButtonElement[] {
  return [saveButton.value, discardButton.value, cancelButton.value].filter(
    (button): button is HTMLButtonElement =>
      !!button && !button.disabled,
  );
}

function onKeyDown(event: KeyboardEvent) {
  if (!props.open || props.busy) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    emit("cancel");
    return;
  }
  if (event.key !== "Tab") {
    return;
  }
  const buttons = focusableButtons();
  if (buttons.length === 0) {
    return;
  }
  const currentIndex = buttons.indexOf(
    document.activeElement as HTMLButtonElement,
  );
  event.preventDefault();
  if (event.shiftKey) {
    const next = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
    buttons[next].focus();
  } else {
    const next = currentIndex >= buttons.length - 1 ? 0 : currentIndex + 1;
    buttons[next].focus();
  }
}

function startListening() {
  if (!listening) {
    window.addEventListener("keydown", onKeyDown, true);
    listening = true;
  }
}

function stopListening() {
  if (listening) {
    window.removeEventListener("keydown", onKeyDown, true);
    listening = false;
  }
}

async function activateDialog() {
  previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  await nextTick();
  startListening();
  saveButton.value?.focus();
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await activateDialog();
      return;
    }
    stopListening();
    previouslyFocused?.focus();
    previouslyFocused = null;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopListening();
});
</script>

<template>
  <div
    v-if="open"
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="dirty-dialog-title"
    aria-describedby="dirty-dialog-message"
    :aria-busy="busy ? 'true' : 'false'"
    data-testid="dirty-dialog"
  >
    <div class="dialog">
      <h2 id="dirty-dialog-title">{{ title }}</h2>
      <p id="dirty-dialog-message">{{ message }}</p>
      <div class="actions">
        <button
          ref="saveButton"
          type="button"
          class="primary"
          data-testid="dirty-save"
          :disabled="busy"
          @click="emit('save')"
        >
          {{ busy ? "保存中…" : "保存" }}
        </button>
        <button
          ref="discardButton"
          type="button"
          data-testid="dirty-discard"
          :disabled="busy"
          @click="emit('discard')"
        >
          不保存
        </button>
        <button
          ref="cancelButton"
          type="button"
          data-testid="dirty-cancel"
          :disabled="busy"
          @click="emit('cancel')"
        >
          取消
        </button>
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

button:disabled {
  cursor: wait;
  opacity: 0.55;
}
</style>
