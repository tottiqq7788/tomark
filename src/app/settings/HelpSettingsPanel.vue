<script setup lang="ts">
import { ref, watch } from "vue";
import type { EncodingHint } from "@/shared/types";

const props = defineProps<{
  active?: boolean;
  canReidentify?: boolean;
}>();

const emit = defineEmits<{
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
  () => props.active,
  (active) => {
    if (!active) {
      showReidentifyOptions.value = false;
    }
  },
);
</script>

<template>
  <div class="help-body" data-testid="help-settings-panel">
    <section>
      <h3>界面</h3>
      <ul>
        <li>默认双栏：左侧 Markdown 源码、右侧渲染结果；可用中间分隔条调宽。</li>
        <li>
          Markdown 源码是唯一数据源，右侧支持受限所见即所得文字编辑；修改会直接写回源码。
        </li>
        <li>右下角视图按钮可在「源码 / 源码+渲染 / 渲染」三种布局间切换。</li>
        <li>
          底部状态栏显示行数、字符数、词数；「?」与齿轮都打开设置，其中「?」直达说明页签，齿轮打开第一项设置；点击顶栏文件名可切换完整路径。
        </li>
      </ul>
    </section>

    <section>
      <h3>标题折叠</h3>
      <ul>
        <li>
          标题行左侧显示层级序号（如 1、1.1、1.2）；普通正文行左侧无编号。点击序号可折叠或展开该标题。
        </li>
        <li>展开中的序号会以强调色标出，便于辨认当前打开的标题分支。</li>
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
        <li>
          安装后可双击 <code>.md</code> / <code>.markdown</code> 用 tomark
          打开（需先设为默认应用或在「打开方式」中选择）。
        </li>
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
          <tr>
            <td>撤销</td>
            <td><kbd>⌘Z</kbd></td>
            <td><kbd>Ctrl+Z</kbd></td>
          </tr>
          <tr>
            <td>重做</td>
            <td><kbd>⌘Y</kbd> / <kbd>⇧⌘Z</kbd></td>
            <td><kbd>Ctrl+Y</kbd> / <kbd>Ctrl+Shift+Z</kbd></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section>
      <h3>右侧文字编辑</h3>
      <ul>
        <li>
          可直接编辑标题、段落、列表项、引用、表格单元格中的普通文字，以及显式链接的显示文字和粗体、斜体、删除线中的普通文字。
        </li>
        <li>
          行内代码、围栏代码块、图片、任务复选框、脚注生成内容、自动链接和 Mermaid
          在右侧只读；显式链接的 URL / title 也只能在源码区修改。
        </li>
        <li>无法可靠映射回源码的内容会保持只读；需要修改时请使用左侧源码区。</li>
        <li>
          链接普通点击用于放置光标；<kbd>Cmd</kbd> / <kbd>Ctrl</kbd>+点击仍定位源码。使用浮动工具条「打开链接」，或
          <kbd>Alt</kbd> / <kbd>Option</kbd>+点击可直接打开链接。
        </li>
        <li>
          在右侧预览中选中同一段落内的文字后，可用浮动工具条或快捷键设置格式；结果会写回左侧
          Markdown 源码。
        </li>
        <li>跨段落选区不会出现格式工具条；无法可靠转换的编辑会被阻止，并提示改用源码区。</li>
        <li>
          左右两侧共用同一套撤销历史：macOS 用 <kbd>⌘Z</kbd> 撤销、<kbd>⌘Y</kbd> /
          <kbd>⇧⌘Z</kbd> 重做；Windows / Linux 用 <kbd>Ctrl+Z</kbd> 撤销、<kbd>Ctrl+Y</kbd> /
          <kbd>Ctrl+Shift+Z</kbd> 重做。
        </li>
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
            <td>加粗</td>
            <td><kbd>⌘B</kbd></td>
            <td><kbd>Ctrl+B</kbd></td>
          </tr>
          <tr>
            <td>斜体</td>
            <td><kbd>⌘I</kbd></td>
            <td><kbd>Ctrl+I</kbd></td>
          </tr>
          <tr>
            <td>删除线</td>
            <td><kbd>⇧⌘X</kbd></td>
            <td><kbd>Ctrl+Shift+X</kbd></td>
          </tr>
          <tr>
            <td>行内代码</td>
            <td><kbd>⌘E</kbd></td>
            <td><kbd>Ctrl+E</kbd></td>
          </tr>
          <tr>
            <td>链接</td>
            <td><kbd>⌘K</kbd></td>
            <td><kbd>Ctrl+K</kbd></td>
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
</template>

<style scoped>
.help-body {
  color: #374151;
  font-size: 13px;
  line-height: 1.6;
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
