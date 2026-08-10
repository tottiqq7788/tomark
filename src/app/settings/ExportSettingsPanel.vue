<script setup lang="ts">
import { nextTick, ref } from "vue";
import ExportProgressDialog, {
  type ExportProgressPhase,
} from "@/app/ExportProgressDialog.vue";
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
}>();

const exporting = ref<ExportFormatId | null>(null);
const progressOpen = ref(false);
const progressPhase = ref<ExportProgressPhase>("running");
const progressTitle = ref("正在导出");
const progressMessage = ref("");
const progressWarnings = ref<ImageWarning[]>([]);

const actions: {
  id: ExportFormatId;
  title: string;
  description: string;
}[] = [
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
    id: "png",
    title: "导出长图 PNG",
    description: "白底长截图；超长文档会自动降采样。",
  },
  {
    id: "pdf",
    title: "导出长图 PDF",
    description: "白底长图单页 PDF（不可检索文字）；超长文档会自动降采样。",
  },
];

function isExportCancelled(error: unknown): boolean {
  return (
    error instanceof ExportCancelledError ||
    (error instanceof Error && error.name === "ExportCancelledError")
  );
}

function actionTitle(format: ExportFormatId): string {
  return actions.find((action) => action.id === format)?.title ?? "导出";
}

function openProgress(title: string, message: string) {
  progressTitle.value = title;
  progressMessage.value = message;
  progressPhase.value = "running";
  progressWarnings.value = [];
  progressOpen.value = true;
}

function finishProgress(
  phase: Exclude<ExportProgressPhase, "running">,
  title: string,
  message: string,
  warnings: ImageWarning[] = [],
) {
  progressPhase.value = phase;
  progressTitle.value = title;
  progressMessage.value = message;
  progressWarnings.value = warnings;
}

function closeProgress() {
  progressOpen.value = false;
  exporting.value = null;
  emit("busy", false);
}

async function yieldForPaint(): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function onExport(format: ExportFormatId) {
  if (exporting.value || props.disabled || progressOpen.value) {
    return;
  }
  const snapshot = {
    markdownSource: props.markdownSource,
    documentPath: props.documentPath,
    fileName: props.fileName,
  };
  exporting.value = format;
  emit("busy", true);

  try {
    const { selectExportTargetPath, runExport } = await import(
      "@/export/runExport"
    );
    // Suspend drawer focus trap first (via busy), then open the native save
    // dialog before painting the progress modal.
    await nextTick();
    const targetPath = await selectExportTargetPath(format, snapshot.fileName);
    if (!targetPath) {
      exporting.value = null;
      emit("busy", false);
      return;
    }

    openProgress(actionTitle(format), "正在准备导出…");
    await yieldForPaint();

    const result = await runExport({
      format,
      ...snapshot,
      targetPath,
      onProgress: (message) => {
        progressMessage.value = message;
      },
    });
    const warningText =
      result.warnings.length > 0
        ? `（${result.warnings.length} 张图片未能嵌入）`
        : "";
    const noteText = result.note ? ` ${result.note}` : "";
    finishProgress(
      "success",
      "导出完成",
      `已导出：${result.fileName}${warningText}${noteText}`,
      result.warnings,
    );
  } catch (error) {
    if (isExportCancelled(error)) {
      // Path cancel is handled above; treat mid-export cancel as a soft result.
      finishProgress("error", "已取消导出", "已取消导出");
    } else {
      const message = error instanceof Error ? error.message : String(error);
      finishProgress("error", "导出失败", `导出失败：${message}`);
    }
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
        :disabled="Boolean(exporting) || disabled || progressOpen"
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

    <ExportProgressDialog
      :open="progressOpen"
      :phase="progressPhase"
      :title="progressTitle"
      :message="progressMessage"
      :warnings="progressWarnings"
      @close="closeProgress"
    />
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
</style>
