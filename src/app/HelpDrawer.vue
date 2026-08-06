<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

/** Keep DOM after first mount so open/close only toggles compositor-friendly classes. */
const present = ref(false);
const shown = ref(false);
const drawerRef = ref<HTMLElement | null>(null);
let closing = false;
let closeFallbackTimer: ReturnType<typeof setTimeout> | undefined;
let warmed = false;

function clearCloseFallback() {
  if (closeFallbackTimer !== undefined) {
    clearTimeout(closeFallbackTimer);
    closeFallbackTimer = undefined;
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && shown.value && !closing) {
    event.preventDefault();
    requestClose();
  }
}

function promoteLayers() {
  // Touch layout once so the first user-visible transition is not cold.
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
  clearCloseFallback();
  closing = false;
  await ensureMounted();
  // One frame ensures the closed transform is committed before opening.
  requestAnimationFrame(() => {
    shown.value = true;
  });
  window.addEventListener("keydown", onKeydown);
}

function requestClose() {
  if (!present.value || closing || !shown.value) {
    return;
  }
  closing = true;
  shown.value = false;
  clearCloseFallback();
  closeFallbackTimer = setTimeout(() => {
    finishClose();
  }, 400);
}

function finishClose() {
  if (shown.value) {
    return;
  }
  clearCloseFallback();
  closing = false;
  // Intentionally keep `present` true — remounting was a major first-open hitch.
  window.removeEventListener("keydown", onKeydown);
  emit("close");
}

function onDrawerTransitionEnd(event: TransitionEvent) {
  if (event.target !== drawerRef.value) {
    return;
  }
  if (event.propertyName !== "transform") {
    return;
  }
  if (!shown.value) {
    finishClose();
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
    }
  },
);

onMounted(() => {
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
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="present"
      class="help-overlay"
      :class="{ 'is-shown': shown }"
      :aria-hidden="shown ? 'false' : 'true'"
      role="presentation"
      @click.self="requestClose"
    >
      <aside
        ref="drawerRef"
        class="help-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-drawer-title"
        @transitionend="onDrawerTransitionEnd"
      >
        <header class="help-header">
          <h2 id="help-drawer-title">使用说明</h2>
          <button
            type="button"
            class="help-close"
            aria-label="关闭使用说明"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <div class="help-body">
          <section>
            <h3>界面</h3>
            <ul>
              <li>左侧约 1/3 为 Markdown 源码，右侧约 2/3 为渲染预览（非所见即所得）。</li>
              <li>拖动中间分隔条可调整两侧宽度。</li>
              <li>底部状态栏显示行数、字符数、词数；右侧「?」可随时打开本说明。</li>
            </ul>
          </section>

          <section>
            <h3>标题折叠</h3>
            <ul>
              <li>打开文档时：沿第一条标题链展开到正文，其余标题默认折叠。</li>
              <li>手动展开某一标题时互斥，只保留该标题及其祖先展开。</li>
              <li>编辑过程中会尽量保留你已展开/折叠的状态，不会反复强制全盘折叠。</li>
            </ul>
          </section>

          <section>
            <h3>双向定位</h3>
            <ul>
              <li>
                按住 <kbd>Cmd</kbd>（Windows / Linux 为 <kbd>Ctrl</kbd>）点击源码行，右侧预览滚动到对应渲染块。
              </li>
              <li>同样修饰键点击预览块时，左侧会展开并滚动到对应源码行。</li>
              <li>空行会定位到最近的可渲染块；不会按标题文本或像素高度猜测。</li>
            </ul>
          </section>

          <section>
            <h3>文件与保存</h3>
            <ul>
              <li>已打开文件：停止输入约 2 秒后自动保存。</li>
              <li>未命名文档：请使用菜单「文件 → 另存为…」落盘。</li>
              <li>顶部右侧图标：黄色表示待保存，绿色对勾表示已同步。</li>
            </ul>
            <table>
              <thead>
                <tr>
                  <th>操作</th>
                  <th>macOS</th>
                  <th>Windows / Linux</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>新建</td>
                  <td><kbd>⌘N</kbd></td>
                  <td><kbd>Ctrl+N</kbd></td>
                </tr>
                <tr>
                  <td>打开</td>
                  <td><kbd>⌘O</kbd></td>
                  <td><kbd>Ctrl+O</kbd></td>
                </tr>
                <tr>
                  <td>另存为</td>
                  <td><kbd>⇧⌘S</kbd></td>
                  <td><kbd>Ctrl+Shift+S</kbd></td>
                </tr>
                <tr>
                  <td>强制保存</td>
                  <td><kbd>⌘S</kbd></td>
                  <td><kbd>Ctrl+S</kbd></td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.help-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: rgba(15, 23, 42, 0);
  /* Only opacity/color — never animate backdrop-filter (main cause of first-frame jank). */
  transition: background-color 280ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.help-overlay.is-shown {
  background: rgba(15, 23, 42, 0.34);
  pointer-events: auto;
}

.help-drawer {
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

.help-overlay.is-shown .help-drawer {
  transform: translate3d(0, 0, 0);
}

.help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: linear-gradient(180deg, #fcfcfd 0%, #f5f6f8 100%);
}

.help-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: #111827;
  letter-spacing: 0.01em;
}

.help-close {
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

.help-close:hover {
  background: #e5e7eb;
  color: #111827;
}

.help-close:active {
  transform: scale(0.94);
}

.help-body {
  overflow: auto;
  padding: 14px 18px 22px;
  color: #374151;
  font-size: 13px;
  line-height: 1.6;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.help-body::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.help-body section + section {
  margin-top: 16px;
}

.help-body h3 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 650;
  color: #111827;
}

.help-body ul {
  margin: 0;
  padding-left: 1.2em;
}

.help-body li + li {
  margin-top: 4px;
}

.help-body table {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
  font-size: 12px;
}

.help-body th,
.help-body td {
  border: 1px solid #e5e7eb;
  padding: 6px 8px;
  text-align: left;
}

.help-body th {
  background: #f8fafc;
  font-weight: 600;
}

kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid #d1d5db;
  border-bottom-width: 2px;
  border-radius: 4px;
  background: #f9fafb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: #111827;
}

@media (prefers-reduced-motion: reduce) {
  .help-overlay,
  .help-drawer {
    transition: none;
  }
}
</style>
