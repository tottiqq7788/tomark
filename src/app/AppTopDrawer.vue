<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { trapFocus } from "@/shared/focusTrap";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    testIdPrefix?: string;
    closeAriaLabel?: string;
    warm?: boolean;
    wide?: boolean;
  }>(),
  {
    testIdPrefix: "drawer",
    closeAriaLabel: "关闭",
    warm: true,
    wide: false,
  },
);

const emit = defineEmits<{
  close: [];
}>();

/** Keep DOM after first mount so open/close only toggles compositor-friendly classes. */
const present = ref(false);
const shown = ref(false);
const drawerRef = ref<HTMLElement | null>(null);

let closing = false;
let keydownBound = false;
let closeEmitted = false;
let openGeneration = 0;
let closeFallbackTimer: ReturnType<typeof setTimeout> | undefined;
let openFrame: number | undefined;
let warmed = false;
let releaseFocusTrap: (() => void) | undefined;

function clearCloseFallback() {
  if (closeFallbackTimer !== undefined) {
    clearTimeout(closeFallbackTimer);
    closeFallbackTimer = undefined;
  }
}

function cancelOpenFrame() {
  if (openFrame !== undefined) {
    cancelAnimationFrame(openFrame);
    openFrame = undefined;
  }
}

function releaseTrap() {
  releaseFocusTrap?.();
  releaseFocusTrap = undefined;
}

function bindKeydown() {
  if (keydownBound) {
    return;
  }
  window.addEventListener("keydown", onKeydown);
  keydownBound = true;
}

function unbindKeydown() {
  if (!keydownBound) {
    return;
  }
  window.removeEventListener("keydown", onKeydown);
  keydownBound = false;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && shown.value && !closing) {
    event.preventDefault();
    requestClose();
  }
}

function promoteLayers() {
  drawerRef.value?.getBoundingClientRect();
}

async function ensureMounted() {
  if (present.value) {
    return;
  }
  present.value = true;
  shown.value = false;
  await nextTick();
  promoteLayers();
}

async function openDrawer() {
  const generation = ++openGeneration;
  clearCloseFallback();
  cancelOpenFrame();
  closing = false;
  closeEmitted = false;
  await ensureMounted();
  if (generation !== openGeneration || !props.open) {
    return;
  }
  // One frame ensures the closed transform is committed before opening.
  openFrame = requestAnimationFrame(() => {
    openFrame = undefined;
    if (generation !== openGeneration || !props.open) {
      return;
    }
    shown.value = true;
    bindKeydown();
    void nextTick(() => {
      if (generation !== openGeneration || !shown.value || !drawerRef.value) {
        return;
      }
      releaseTrap();
      releaseFocusTrap = trapFocus(drawerRef.value);
    });
  });
}

function requestClose() {
  if (!present.value || closing || !shown.value) {
    return;
  }
  const generation = openGeneration;
  closing = true;
  shown.value = false;
  releaseTrap();
  clearCloseFallback();
  cancelOpenFrame();
  closeFallbackTimer = setTimeout(() => {
    if (generation !== openGeneration) {
      return;
    }
    finishClose(generation);
  }, 400);
}

function finishClose(expectedGeneration = openGeneration) {
  if (expectedGeneration !== openGeneration) {
    return;
  }
  // Ignore stale end events if the drawer was reopened mid-close.
  if (shown.value) {
    return;
  }
  clearCloseFallback();
  closing = false;
  unbindKeydown();
  releaseTrap();
  // Emit even while props.open is still true (button / Escape / overlay):
  // parent sets open=false on this event; openGeneration guards reopen races.
  if (!closeEmitted) {
    closeEmitted = true;
    emit("close");
  }
}

function onDrawerTransitionEnd(event: TransitionEvent) {
  if (event.target !== drawerRef.value) {
    return;
  }
  if (event.propertyName !== "transform") {
    return;
  }
  if (!shown.value) {
    finishClose(openGeneration);
  }
}

async function warmInIdle() {
  if (warmed || present.value) {
    return;
  }
  warmed = true;
  await ensureMounted();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void openDrawer();
      return;
    }
    if (shown.value) {
      requestClose();
      // The parent already changed `open` to false; a delayed transition event
      // must not emit another close that could dismiss a newly opened drawer.
      closeEmitted = true;
      return;
    }
    // Closed before the open rAF ran — drop pending open without emitting.
    clearCloseFallback();
    cancelOpenFrame();
    closing = false;
    closeEmitted = true;
    unbindKeydown();
    releaseTrap();
  },
  { immediate: true },
);

onMounted(() => {
  if (!props.warm) {
    return;
  }
  const ric = (
    window as Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    ric(() => {
      void warmInIdle();
    }, { timeout: 1800 });
  } else {
    window.setTimeout(() => {
      void warmInIdle();
    }, 800);
  }
});

onBeforeUnmount(() => {
  clearCloseFallback();
  cancelOpenFrame();
  unbindKeydown();
  releaseTrap();
});

defineExpose({ requestClose });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="present"
      class="top-drawer-overlay"
      :class="{ 'is-shown': shown }"
      :aria-hidden="shown ? 'false' : 'true'"
      :inert="shown ? undefined : true"
      role="presentation"
      :data-testid="`${testIdPrefix}-overlay`"
      @click.self="requestClose"
    >
      <aside
        ref="drawerRef"
        class="top-drawer"
        :class="{ 'is-wide': wide }"
        role="dialog"
        :aria-modal="shown ? 'true' : 'false'"
        :aria-labelledby="`${testIdPrefix}-title`"
        tabindex="-1"
        :data-testid="`${testIdPrefix}-drawer`"
        @transitionend="onDrawerTransitionEnd"
      >
        <header class="top-drawer-header">
          <h2 :id="`${testIdPrefix}-title`">{{ title }}</h2>
          <button
            type="button"
            class="top-drawer-close"
            :aria-label="closeAriaLabel"
            :data-testid="`${testIdPrefix}-close`"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <div class="top-drawer-body">
          <slot />
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.top-drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: rgba(15, 23, 42, 0);
  transition: background-color 280ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.top-drawer-overlay.is-shown {
  background: rgba(15, 23, 42, 0.34);
  pointer-events: auto;
}

.top-drawer {
  width: min(720px, 100%);
  max-height: min(78vh, 640px);
  background: #fff;
  border-radius: 0 0 16px 16px;
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.7) inset,
    0 22px 56px rgba(15, 23, 42, 0.2);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  transform: translate3d(0, -104%, 0);
  transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
  will-change: transform;
  backface-visibility: hidden;
}

.top-drawer.is-wide {
  width: min(860px, 100%);
  max-height: min(82vh, 720px);
}

.top-drawer-overlay.is-shown .top-drawer {
  transform: translate3d(0, 0, 0);
}

.top-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(180deg, #fcfcfd 0%, #f5f6f8 100%);
}

.top-drawer-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: #111827;
  letter-spacing: 0.01em;
}

.top-drawer-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.top-drawer-close:hover {
  background: #e5e7eb;
  color: #111827;
}

.top-drawer-close:active {
  transform: scale(0.94);
}

.top-drawer-body {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

@media (prefers-reduced-motion: reduce) {
  .top-drawer-overlay,
  .top-drawer {
    transition: none;
  }
}
</style>
