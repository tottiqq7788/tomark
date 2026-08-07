<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  isSafeLinkHref,
  type ActiveFormats,
  type InlineFormat,
} from "@/shared/previewFormatting";

const props = defineProps<{
  visible: boolean;
  top: number;
  /** Viewport X of the selection center; toolbar is translated -50%. */
  centerX: number;
  active: ActiveFormats;
}>();

const root = ref<HTMLElement | null>(null);
defineExpose({ root });

const emit = defineEmits<{
  toggle: [format: Exclude<InlineFormat, "link">];
  "apply-link": [href: string];
  "remove-link": [];
  dismiss: [];
  "link-editing": [open: boolean];
}>();

const linkOpen = ref(false);
const linkHref = ref("");
const linkInput = ref<HTMLInputElement | null>(null);
const linkError = ref<string | null>(null);

function setLinkOpen(open: boolean) {
  linkOpen.value = open;
  emit("link-editing", open);
  if (!open) {
    linkHref.value = "";
    linkError.value = null;
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      setLinkOpen(false);
    }
  },
);

watch(
  () => props.active.linkHref,
  (href) => {
    if (linkOpen.value && href) {
      linkHref.value = href;
    }
  },
);

async function onLinkClick() {
  if (props.active.link) {
    emit("remove-link");
    return;
  }
  setLinkOpen(true);
  linkHref.value = props.active.linkHref ?? "https://";
  linkError.value = null;
  await nextTick();
  linkInput.value?.focus();
  linkInput.value?.select();
}

function submitLink() {
  const href = linkHref.value.trim();
  if (!isSafeLinkHref(href)) {
    linkError.value = "链接地址无效或不安全";
    return;
  }
  linkError.value = null;
  emit("apply-link", href);
  setLinkOpen(false);
}

function onLinkKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    submitLink();
  } else if (event.key === "Escape") {
    event.preventDefault();
    setLinkOpen(false);
    emit("dismiss");
  }
}

function onToolbarKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (linkOpen.value) {
      setLinkOpen(false);
      return;
    }
    emit("dismiss");
  }
}

/** Prevent mousedown from clearing the preview text selection. */
function retainSelection(event: MouseEvent) {
  event.preventDefault();
}
</script>

<template>
  <div
    ref="root"
    v-show="visible"
    class="format-toolbar"
    role="toolbar"
    aria-label="预览文字格式"
    :style="{ top: `${top}px`, left: `${centerX}px` }"
    data-testid="preview-format-toolbar"
    @keydown="onToolbarKeydown"
  >
    <button
      type="button"
      class="format-btn"
      title="加粗"
      aria-label="加粗"
      :aria-pressed="active.bold"
      data-testid="format-bold"
      @mousedown="retainSelection"
      @click="emit('toggle', 'bold')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M4 2h5.2c2.1 0 3.5 1.2 3.5 3 0 1.1-.6 2-1.5 2.5 1.3.4 2.2 1.5 2.2 2.9 0 2.1-1.6 3.6-4.1 3.6H4V2zm2.1 1.8v3h2.7c1.1 0 1.7-.5 1.7-1.5s-.6-1.5-1.7-1.5H6.1zm0 4.7v3.5h3.1c1.3 0 2-.6 2-1.7s-.7-1.8-2.1-1.8H6.1z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="format-btn"
      title="斜体"
      aria-label="斜体"
      :aria-pressed="active.italic"
      data-testid="format-italic"
      @mousedown="retainSelection"
      @click="emit('toggle', 'italic')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M7.2 2h5.1l-.4 1.6H10L7.6 12.4h1.9L9.1 14H4l.4-1.6h1.9L8.7 3.6H6.8L7.2 2z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="format-btn"
      title="删除线"
      aria-label="删除线"
      :aria-pressed="active.strike"
      data-testid="format-strike"
      @mousedown="retainSelection"
      @click="emit('toggle', 'strike')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M3 7.2h10v1.5H3V7.2zm5.1-4.7c1.9 0 3.2.8 3.7 2.1l-1.6.5c-.3-.7-.9-1.1-2-1.1-1.1 0-1.8.5-1.8 1.2 0 .5.3.8 1.5 1.1l1.2.3c2 .5 3 1.4 3 3 0 1.9-1.5 3.2-3.9 3.2-2.1 0-3.6-1-4.1-2.5l1.7-.5c.3.9 1.1 1.4 2.4 1.4 1.2 0 1.9-.5 1.9-1.3 0-.6-.4-1-1.7-1.3l-1.2-.3C4.9 7.9 4 6.9 4 5.4 4 3.6 5.4 2.5 8.1 2.5z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="format-btn"
      title="行内代码"
      aria-label="行内代码"
      :aria-pressed="active.code"
      data-testid="format-code"
      @mousedown="retainSelection"
      @click="emit('toggle', 'code')"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5.8 4.2 2.4 8l3.4 3.8-1.3 1.1L0 8l4.5-4.9 1.3 1.1zm4.4 0 1.3-1.1L16 8l-4.5 4.9-1.3-1.1L13.6 8 10.2 4.2z"
        />
      </svg>
    </button>
    <button
      type="button"
      class="format-btn"
      title="链接"
      aria-label="链接"
      :aria-pressed="active.link"
      data-testid="format-link"
      @mousedown="retainSelection"
      @click="onLinkClick"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M6.4 9.6a3.2 3.2 0 0 1 0-4.5l1.8-1.8a3.2 3.2 0 0 1 4.5 4.5l-.9.9-1.1-1.1.9-.9a1.6 1.6 0 1 0-2.3-2.3L7.5 6.2a1.6 1.6 0 0 0 0 2.3l1.1 1.1-1.1 1.1-1.1-1.1zm3.2-3.2a3.2 3.2 0 0 1 0 4.5L7.8 12.7a3.2 3.2 0 0 1-4.5-4.5l.9-.9 1.1 1.1-.9.9a1.6 1.6 0 1 0 2.3 2.3l1.8-1.8a1.6 1.6 0 0 0 0-2.3L7.4 6.4l1.1-1.1 1.1 1.1z"
        />
      </svg>
    </button>

    <div v-if="linkOpen" class="link-editor" data-testid="format-link-editor">
      <input
        ref="linkInput"
        v-model="linkHref"
        type="text"
        class="link-input"
        aria-label="链接地址"
        placeholder="https://"
        @keydown="onLinkKeydown"
      />
      <button
        type="button"
        class="link-confirm"
        data-testid="format-link-confirm"
        @mousedown="retainSelection"
        @click="submitLink"
      >
        确认
      </button>
      <p v-if="linkError" class="link-error" role="alert">{{ linkError }}</p>
    </div>
  </div>
</template>

<style scoped>
.format-toolbar {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  padding: 4px;
  max-width: min(360px, calc(100vw - 16px));
  /* left is the selection center; shift back by half the real width. */
  transform: translateX(-50%);
  background: #111827;
  color: #f9fafb;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28);
}

.format-btn {
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

.format-btn:hover,
.format-btn:focus-visible {
  background: rgba(255, 255, 255, 0.12);
  outline: none;
}

.format-btn[aria-pressed="true"] {
  background: rgba(96, 165, 250, 0.35);
  color: #dbeafe;
}

.format-btn svg {
  width: 14px;
  height: 14px;
}

.link-editor {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  width: 100%;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}

.link-input {
  flex: 1 1 160px;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: #1f2937;
  color: #f9fafb;
  font-size: 12px;
}

.link-confirm {
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: #3b82f6;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}

.link-confirm:hover,
.link-confirm:focus-visible {
  background: #2563eb;
  outline: none;
}

.link-error {
  flex: 1 1 100%;
  margin: 0;
  color: #fecaca;
  font-size: 11px;
}
</style>
