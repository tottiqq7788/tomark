import { computed, ref } from "vue";
import type { DocumentFormat } from "@/shared/types";
import { UNTITLED_NAME } from "@/shared/types";
import {
  createEmptyDocument,
  openMarkdownFile,
  saveMarkdownFile,
  saveMarkdownFileAs,
  showError,
} from "@/native/fileService";

const SAMPLE = `# tomark

轻量级 Markdown 编辑器示例。

## 开始

- 左侧编辑源码
- 右侧查看预览
- 点击行首 ◎ 定位到预览

### 折叠

打开文档时标题默认收起，可逐层展开。

## 表格

| 功能 | 状态 |
| --- | --- |
| GFM | 支持 |
| 定位 | 支持 |
`;

export function useDocumentSession() {
  const path = ref<string | null>(null);
  const fileName = ref(UNTITLED_NAME);
  const content = ref(SAMPLE);
  const savedContent = ref(SAMPLE);
  const format = ref<DocumentFormat>({ lineEnding: "lf", hasBom: false });
  const documentVersion = ref(0);
  const statusMessage = ref("");
  const dirtyDialogOpen = ref(false);

  let dirtyResolver: ((ok: boolean) => void) | null = null;

  const dirty = computed(() => content.value !== savedContent.value);
  const title = computed(
    () => `tomark — ${fileName.value}${dirty.value ? " *" : ""}`,
  );

  function bumpVersion() {
    documentVersion.value += 1;
  }

  function applyLoaded(doc: {
    path: string | null;
    fileName: string;
    content: string;
    format: DocumentFormat;
  }) {
    path.value = doc.path;
    fileName.value = doc.fileName;
    content.value = doc.content;
    savedContent.value = doc.content;
    format.value = doc.format;
    bumpVersion();
    statusMessage.value = doc.path ? `已打开 ${doc.fileName}` : "新建文档";
  }

  function resolveDirty(ok: boolean) {
    dirtyDialogOpen.value = false;
    const resolve = dirtyResolver;
    dirtyResolver = null;
    resolve?.(ok);
  }

  async function guardDirty(): Promise<boolean> {
    if (!dirty.value) {
      return true;
    }
    dirtyDialogOpen.value = true;
    return new Promise<boolean>((resolve) => {
      dirtyResolver = resolve;
    });
  }

  async function onDirtySave() {
    const ok = await save();
    resolveDirty(ok);
  }

  function onDirtyDiscard() {
    resolveDirty(true);
  }

  function onDirtyCancel() {
    resolveDirty(false);
  }

  async function newDocument() {
    if (!(await guardDirty())) {
      return;
    }
    applyLoaded(createEmptyDocument());
  }

  async function openDocument() {
    if (!(await guardDirty())) {
      return;
    }
    try {
      const doc = await openMarkdownFile();
      if (!doc) {
        return;
      }
      applyLoaded(doc);
    } catch (error) {
      await showError("打开失败", error);
    }
  }

  async function save(): Promise<boolean> {
    try {
      if (!path.value) {
        return saveAs();
      }
      await saveMarkdownFile(path.value, content.value, format.value);
      savedContent.value = content.value;
      statusMessage.value = `已保存 ${fileName.value}`;
      return true;
    } catch (error) {
      await showError("保存失败", error);
      return false;
    }
  }

  async function saveAs(): Promise<boolean> {
    try {
      const doc = await saveMarkdownFileAs(
        content.value,
        format.value,
        path.value ?? fileName.value,
      );
      if (!doc) {
        return false;
      }
      path.value = doc.path;
      fileName.value = doc.fileName;
      savedContent.value = content.value;
      statusMessage.value = `已保存 ${doc.fileName}`;
      return true;
    } catch (error) {
      await showError("另存为失败", error);
      return false;
    }
  }

  function setContent(next: string) {
    content.value = next;
  }

  return {
    path,
    fileName,
    content,
    format,
    dirty,
    title,
    documentVersion,
    statusMessage,
    dirtyDialogOpen,
    setContent,
    newDocument,
    openDocument,
    save,
    saveAs,
    onDirtySave,
    onDirtyDiscard,
    onDirtyCancel,
  };
}
