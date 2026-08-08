<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { ImageWarning } from "@/export/types";

export type ExportProgressPhase = "running" | "success" | "error";

const props = defineProps<{
  open: boolean;
  phase: ExportProgressPhase;
  title: string;
  message: string;
  warnings?: ImageWarning[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const dialogRef = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
let previouslyFocused: HTMLElement | null = null;
let listening = false;

function onKeyDown(event: KeyboardEvent) {
  if (!props.open) {
    return;
  }
  if (event.key === "Escape") {
    if (props.phase === "running") {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    emit("close");
    return;
  }
  if (event.key !== "Tab" || props.phase === "running") {
    return;
  }
  const button = closeButton.value;
  if (!button) {
    return;
  }
  event.preventDefault();
  button.focus();
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
  if (props.phase === "running") {
    dialogRef.value?.focus({ preventScroll: true });
    return;
  }
  closeButton.value?.focus();
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

watch(
  () => props.phase,
  async (phase) => {
    if (!props.open || phase === "running") {
      return;
    }
    await nextTick();
    closeButton.value?.focus();
  },
);

onBeforeUnmount(() => {
  stopListening();
});
</script>

<template>
  <div
    v-if="open"
    ref="dialogRef"
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-progress-title"
    aria-describedby="export-progress-message"
    :aria-busy="phase === 'running' ? 'true' : 'false'"
    tabindex="-1"
    data-testid="export-progress-dialog"
  >
    <div class="dialog">
      <h2 id="export-progress-title">{{ title }}</h2>
      <p
        id="export-progress-message"
        class="message"
        role="status"
        data-testid="export-progress-message"
      >
        {{ message }}
      </p>

      <div
        v-if="phase === 'running'"
        class="progress-track"
        data-testid="export-progress-bar"
        aria-hidden="true"
      >
        <div class="progress-bar" />
      </div>

      <ul
        v-if="warnings && warnings.length > 0"
        class="warnings"
        data-testid="export-progress-warnings"
      >
        <li
          v-for="(warning, index) in warnings"
          :key="`${warning.src}-${index}`"
        >
          {{ warning.src }}：{{ warning.reason }}
        </li>
      </ul>

      <div class="actions">
        <button
          v-if="phase !== 'running'"
          ref="closeButton"
          type="button"
          class="primary"
          data-testid="export-progress-close"
          @click="emit('close')"
        >
          关闭
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
  z-index: 70;
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

.message {
  margin: 0 0 14px;
  color: #4b5563;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.progress-track {
  position: relative;
  height: 6px;
  margin: 0 0 16px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}

.progress-bar {
  position: absolute;
  inset: 0 auto 0 0;
  width: 40%;
  border-radius: inherit;
  background: #2563eb;
  animation: export-progress-indeterminate 1.1s ease-in-out infinite;
}

.warnings {
  margin: 0 0 14px;
  padding-left: 1.2em;
  color: #b45309;
  font-size: 12px;
  line-height: 1.45;
}

.warnings li + li {
  margin-top: 4px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  min-height: 32px;
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

@keyframes export-progress-indeterminate {
  0% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(320%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-bar {
    width: 100%;
    animation: none;
    opacity: 0.7;
  }
}
</style>
