<script setup lang="ts">
import { nextTick, ref } from "vue";
import {
  ExportCancelledError,
  type ExportFormatId,
  type ImageWarning,
} from "@/export/types";

const props = defineProps<{
  markdownSource: string;
  documentPath: string | null;
  fileName: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  busy: [busy: boolean];
  "status-message": [message: string];
}>();

const exporting = ref<ExportFormatId | null>(null);
const lastMessage = ref("");
const lastWarnings = ref<ImageWarning[]>([]);

const actions: {
  id: ExportFormatId;
  title: string;
  description: string;
}[] = [
  {
    id: "pdf",
    title: "导出 PDF（单页长页）",
    description: "矢量文字、中文可选择搜索；整篇一页，不分页。",
  },
  {
    id: "pdf-paged",
    title: "导出 PDF（矢量分页）",
    description: "A4 纵向分页；矢量可搜索；图片/图表尽量整块换页，避免从中间切开。",
  },
  {
    id: "html-embedded",
    title: "导出 HTML（嵌入图片）",
    description: "单文件 HTML，尽量把图片写成 data URL。",
  },
  {
    id: "html-assets",
    title: "导出 HTML（资源目录）",
    description: "生成 HTML 与同名 _files 目录，图片使用相对路径。",
  },
  {
    id: "docx",
    title: "导出 Word（DOCX）",
    description: "可编辑的 Word 文档，尽量内嵌图片。",
  },
  {
    id: "png",
    title: "导出长图 PNG",
    description: "白底长截图；超长文档会自动降采样。",
  },
];

function isExportCancelled(error: unknown): boolean {
  return (
    error instanceof ExportCancelledError ||
    (error instanceof Error && error.name === "ExportCancelledError")
  );
}

async function onExport(format: ExportFormatId) {
  if (exporting.value || props.disabled) {
    return;
  }
  exporting.value = format;
  lastWarnings.value = [];
  lastMessage.value = "";
  emit("busy", true);
  emit("status-message", "正在导出…");
  // Let the settings drawer close and release its focus trap before any
  // native save dialog (otherwise macOS can leave the export looking stuck).
  await nextTick();
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 50);
  });
  try {
    const { runExport } = await import("@/export/runExport");
    const result = await runExport({
      format,
      markdownSource: props.markdownSource,
      documentPath: props.documentPath,
      fileName: props.fileName,
      onProgress: (message) => emit("status-message", message),
    });
    lastWarnings.value = result.warnings;
    const warningText =
      result.warnings.length > 0
        ? `（${result.warnings.length} 张图片未能嵌入）`
        : "";
    const noteText = result.note ? ` ${result.note}` : "";
    lastMessage.value = `已导出：${result.fileName}${warningText}${noteText}`;
    emit("status-message", lastMessage.value);
  } catch (error) {
    if (isExportCancelled(error)) {
      lastMessage.value = "已取消导出";
      emit("status-message", lastMessage.value);
    } else {
      const message =
        error instanceof Error ? error.message : String(error);
      lastMessage.value = `导出失败：${message}`;
      emit("status-message", lastMessage.value);
    }
  } finally {
    exporting.value = null;
    emit("busy", false);
  }
}
</script>

<template>
  <div class="export-panel" data-testid="export-settings-panel">
    <header class="export-header">
      <h3>导出</h3>
      <p>使用当前编辑器中的 Markdown 内容（含未保存修改）进行导出。</p>
    </header>

    <div class="export-actions">
      <button
        v-for="action in actions"
        :key="action.id"
        type="button"
        class="export-action"
        :disabled="Boolean(exporting) || disabled"
        :data-testid="`export-action-${action.id}`"
        :aria-busy="exporting === action.id ? 'true' : 'false'"
        @click="void onExport(action.id)"
      >
        <span class="export-action-title">
          {{
            exporting === action.id ? `${action.title}…` : action.title
          }}
        </span>
        <span class="export-action-desc">{{ action.description }}</span>
      </button>
    </div>

    <p
      v-if="lastMessage"
      class="export-status"
      data-testid="export-status"
      role="status"
    >
      {{ lastMessage }}
    </p>

    <ul
      v-if="lastWarnings.length > 0"
      class="export-warnings"
      data-testid="export-warnings"
    >
      <li v-for="(warning, index) in lastWarnings" :key="`${warning.src}-${index}`">
        {{ warning.src }}：{{ warning.reason }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.export-panel {
  color: #374151;
  font-size: 13px;
  line-height: 1.55;
}

.export-header h3 {
  margin: 0 0 6px;
  font-size: 14px;
  font-weight: 650;
  color: #111827;
}

.export-header p {
  margin: 0 0 14px;
  color: #6b7280;
}

.export-actions {
  display: grid;
  gap: 10px;
}

.export-action {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #dbeafe;
  border-radius: 10px;
  background: #f8fbff;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.export-action:hover:not(:disabled) {
  background: #eff6ff;
  border-color: #93c5fd;
}

.export-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.export-action:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 1px;
}

.export-action-title {
  font-size: 13px;
  font-weight: 650;
  color: #1d4ed8;
}

.export-action-desc {
  font-size: 12px;
  color: #6b7280;
}

.export-status {
  margin: 14px 0 0;
  color: #111827;
}

.export-warnings {
  margin: 8px 0 0;
  padding-left: 1.2em;
  color: #b45309;
  font-size: 12px;
}

.export-warnings li + li {
  margin-top: 4px;
}
</style>
