<script setup lang="ts">
import { ref, watch } from "vue";
import AppTopDrawer from "@/app/AppTopDrawer.vue";
import type { EncodingHint } from "@/shared/types";

const props = defineProps<{
  open: boolean;
  canReidentify?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  "request-default-app": [];
  reidentify: [hint: EncodingHint];
}>();

const showReidentifyOptions = ref(false);

const REIDENTIFY_OPTIONS: { hint: EncodingHint; label: string }[] = [
  { hint: "auto", label: "自动" },
  { hint: "simplifiedChinese", label: "简体中文" },
  { hint: "traditionalChinese", label: "繁体中文" },
  { hint: "japanese", label: "日文" },
  { hint: "korean", label: "韩文" },
  { hint: "western", label: "西文" },
];

function onPickReidentify(hint: EncodingHint) {
  showReidentifyOptions.value = false;
  emit("reidentify", hint);
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      showReidentifyOptions.value = false;
    }
  },
);
</script>

<template>
  <AppTopDrawer
    :open="open"
    title="使用说明"
    test-id-prefix="help"
    close-aria-label="关闭使用说明"
    @close="emit('close')"
  >
    <div class="help-body">
      <section>
        <h3>界面</h3>
        <ul>
          <li>默认双栏：左侧源码、右侧渲染预览（非所见即所得）；可用中间分隔条调宽。</li>
          <li>右下角视图按钮可在「源码 / 源码+渲染 / 渲染」三种布局间切换。</li>
          <li>
            底部状态栏显示行数、字符数、词数；「?」打开本说明，齿轮打开设置；点击顶栏文件名可切换完整路径。
          </li>
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
          <li>安装后可双击 <code>.md</code> / <code>.markdown</code> 用 tomark 打开（需先设为默认应用或在「打开方式」中选择）。</li>
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

      <section>
        <h3>默认应用</h3>
        <ul>
          <li>可将 tomark 设为 Markdown 的系统默认打开方式。</li>
          <li>macOS 会发起系统请求（可能需确认）；Windows 会打开默认应用设置页。</li>
        </ul>
        <button
          type="button"
          class="help-action"
          data-testid="help-set-default-app"
          @click="emit('request-default-app')"
        >
          设置为 Markdown 默认应用
        </button>
      </section>

      <section v-if="canReidentify">
        <h3>文本显示异常？</h3>
        <ul>
          <li>通常会自动识别常见文本格式；若显示乱码，可手动重新识别。</li>
        </ul>
        <button
          type="button"
          class="help-action"
          data-testid="help-reidentify-toggle"
          @click="showReidentifyOptions = !showReidentifyOptions"
        >
          重新识别
        </button>
        <div
          v-if="showReidentifyOptions"
          class="reidentify-options"
          data-testid="help-reidentify-options"
        >
          <button
            v-for="option in REIDENTIFY_OPTIONS"
            :key="option.hint"
            type="button"
            class="help-action secondary"
            :data-testid="`help-reidentify-${option.hint}`"
            @click="onPickReidentify(option.hint)"
          >
            {{ option.label }}
          </button>
        </div>
      </section>
    </div>
  </AppTopDrawer>
</template>

<style scoped>
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

.help-action {
  margin-top: 10px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #93c5fd;
  border-radius: 8px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.help-action.secondary {
  background: #fff;
  border-color: #d1d5db;
  color: #374151;
}

.help-action:hover {
  background: #dbeafe;
}

.help-action.secondary:hover {
  background: #f3f4f6;
}

.reidentify-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}

.reidentify-options .help-action {
  margin-top: 0;
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
</style>
