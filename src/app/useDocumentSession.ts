import { computed, ref } from "vue";
import type { DocumentFormat } from "@/shared/types";
import { UNTITLED_NAME } from "@/shared/types";

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

type FileService = typeof import("@/native/fileService");

let fileServicePromise: Promise<FileService> | null = null;

async function loadFileService(): Promise<FileService> {
  if (!fileServicePromise) {
    fileServicePromise = import("@/native/fileService");
  }
  return fileServicePromise;
}

export function useDocumentSession() {
  const path = ref<string | null>(null);
  const fileName = ref(UNTITLED_NAME);
  const content = ref(SAMPLE);
  const savedContent = ref(SAMPLE);
  const format = ref<DocumentFormat>({ lineEnding: "lf", hasBom: false });
  const documentVersion = ref(0);
  const statusMessage = ref("");
  const dirtyDialogOpen = ref(false);
  const saving = ref(false);

  let dirtyResolver: ((ok: boolean) => void) | null = null;
  let dirtyGuardPromise: Promise<boolean> | null = null;

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
    dirtyGuardPromise = null;
    resolve?.(ok);
  }

  function guardDirty(): Promise<boolean> {
    if (!dirty.value) {
      return Promise.resolve(true);
    }
    if (dirtyGuardPromise) {
      return dirtyGuardPromise;
    }
    dirtyDialogOpen.value = true;
    dirtyGuardPromise = new Promise<boolean>((resolve) => {
      dirtyResolver = resolve;
    });
    return dirtyGuardPromise;
  }

  async function onDirtySave() {
    const ok = await save();
    if (!ok) {
      resolveDirty(false);
      return;
    }
    if (dirty.value) {
      statusMessage.value = "保存期间内容已更改，请再次保存";
      return;
    }
    resolveDirty(true);
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
    const { createEmptyDocument } = await loadFileService();
    applyLoaded(createEmptyDocument());
  }

  async function openDocument() {
    if (!(await guardDirty())) {
      return;
    }
    const { openMarkdownFile, showError } = await loadFileService();
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

  async function runSave(action: () => Promise<boolean>): Promise<boolean> {
    if (saving.value) {
      return false;
    }
    saving.value = true;
    try {
      return await action();
    } finally {
      saving.value = false;
    }
  }

  async function saveAsCurrent(): Promise<boolean> {
    const versionAtStart = documentVersion.value;
    const snapshot = content.value;
    const formatAtStart = { ...format.value };
    const defaultPath = path.value ?? fileName.value;
    const { saveMarkdownFileAs, showError } = await loadFileService();

    try {
      const doc = await saveMarkdownFileAs(
        snapshot,
        formatAtStart,
        defaultPath,
      );
      if (!doc) {
        return false;
      }
      if (documentVersion.value !== versionAtStart) {
        return false;
      }
      path.value = doc.path;
      fileName.value = doc.fileName;
      savedContent.value = snapshot;
      statusMessage.value =
        content.value === snapshot
          ? `已保存 ${doc.fileName}`
          : `已保存 ${doc.fileName}，仍有未保存更改`;
      return true;
    } catch (error) {
      await showError("另存为失败", error);
      return false;
    }
  }

  async function save(): Promise<boolean> {
    return runSave(async () => {
      const targetPath = path.value;
      if (!targetPath) {
        return saveAsCurrent();
      }

      const versionAtStart = documentVersion.value;
      const targetName = fileName.value;
      const snapshot = content.value;
      const formatAtStart = { ...format.value };
      const { saveMarkdownFile, showError } = await loadFileService();

      try {
        await saveMarkdownFile(targetPath, snapshot, formatAtStart);
        if (
          documentVersion.value !== versionAtStart ||
          path.value !== targetPath
        ) {
          return false;
        }
        savedContent.value = snapshot;
        statusMessage.value =
          content.value === snapshot
            ? `已保存 ${targetName}`
            : `已保存 ${targetName}，仍有未保存更改`;
        return true;
      } catch (error) {
        await showError("保存失败", error);
        return false;
      }
    });
  }

  async function saveAs(): Promise<boolean> {
    return runSave(saveAsCurrent);
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
    saving,
    setContent,
    guardDirty,
    newDocument,
    openDocument,
    save,
    saveAs,
    onDirtySave,
    onDirtyDiscard,
    onDirtyCancel,
  };
}
