import { computed, ref } from "vue";
import type { DocumentFormat } from "@/shared/types";
import { UNTITLED_NAME } from "@/shared/types";
import { debounce } from "@/shared/debounce";

const SAMPLE = `# tomark

轻量级跨平台 Markdown 编辑器。左侧编辑源码，右侧实时预览；标题可折叠，行首 ◎ 可定位到对应预览块。

## 快速上手

1. 在左侧改写任意段落，右侧大约 200ms 内刷新预览
2. 点击行首 **◎**，预览会滚动到对应渲染位置
3. 打开文档时标题默认折叠，点标题旁三角可逐层展开
4. 拖动中间分隔条，可调整源码区与预览区宽度

### 编辑与保存

- 已打开文件：停止输入约 2 秒后自动保存
- 未命名文档：用菜单 **文件 → 另存为…** 落盘
- 顶部右侧图标：黄色表示待保存，绿色对勾表示已同步

### 快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 新建 | ⌘N | Ctrl+N |
| 打开 | ⌘O | Ctrl+O |
| 另存为 | ⇧⌘S | Ctrl+Shift+S |
| 强制保存 | ⌘S | Ctrl+S |

## 标题层级与折叠

下面多层标题用来测试默认折叠、展开与定位。

### 二级下的三级 A

正文段落：折叠标题时应只收起「本标题到下一个同级/更高级标题之前」的内容。编辑中间插入空行或改写正文时，折叠状态应尽量保留。

#### 四级标题示例

更深层的内容仍然属于三级 A 的范围，直到出现同级或更高级标题。

### 二级下的三级 B

另一段可折叠内容，方便对比相邻标题的展开状态是否互相独立。

## 常见 Markdown 语法

### 强调与链接

普通段落里可以混用 *斜体*、**粗体**、~~删除线~~，以及行内 \`code\`。

也可以放链接：[tomark 仓库](https://github.com/tottiqq7788/tomark) 与自动链接 https://example.com 。

### 列表

无序列表：

- 苹果
- 香蕉
  - 小蕉
  - 大蕉
- 橙子

任务列表：

- [x] 双栏布局
- [x] 标题折叠
- [x] 行级预览定位
- [ ] 更多主题与字体设置（示例待办）

### 引用

> 预览定位不要用标题文本或像素高度去猜。
>
> 空行应落到最近的可渲染块；有源码行信息的 AST 节点才是可靠锚点。

### 代码

行内代码：\`npm run tauri:dev\`。

围栏代码块：

\`\`\`ts
export function greet(name: string): string {
  return \`hello, \${name}\`;
}

console.log(greet("tomark"));
\`\`\`

\`\`\`bash
cd deps
npm run tauri:dev
\`\`\`

### 表格（宽内容）

| 模块 | 技术 | 说明 |
| --- | --- | --- |
| 桌面壳 | Tauri 2 + Rust | 窗口、文件对话框、原子写入 |
| 前端 | Vue 3 + Vite | HMR 开发预览 |
| 编辑器 | CodeMirror 6 | 折叠 gutter + 定位 gutter |
| Markdown | unified / remark GFM | 保留源码行映射 |

### 分隔线

---

## 长文滚动测试

这一段故意写得稍长，方便测试预览滚动、定位按钮和分隔条拖动后的布局。

第一段：打开一份稍长的文档时，默认折叠可以把大纲收成紧凑结构；你只需展开当前关心的章节。编辑时不要反复强制整篇折叠，否则用户手动展开的节点会被冲掉。

第二段：自动保存采用「停止编辑后再写盘」的策略，连续敲字过程中不会每次按键都触发磁盘写入。已有路径的文件在空闲约两秒后落盘；未命名文件保持黄色状态，直到另存为成功。

第三段：关闭窗口、新建或打开其他文件前，会先冲刷待写入的自动保存。若仍是未命名且有改动，会出现未保存确认框，可选保存、不保存或取消。

### 再放一段列表方便定位

1. 在左侧找到本标题附近的某一行
2. 点击该行左侧 ◎
3. 观察右侧是否滚到本列表或邻近段落
4. 折叠上级标题后再展开，确认定位仍然可用

## 结尾

祝编辑愉快。改完示例内容后，可以用 **文件 → 另存为…** 存成自己的笔记模板。
`;

export const AUTOSAVE_WAIT_MS = 2_000;

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
  let disposed = false;
  let autosaveFailureCount = 0;

  const dirty = computed(() => content.value !== savedContent.value);
  const title = computed(
    () => `tomark — ${fileName.value}${dirty.value ? " *" : ""}`,
  );
  /** Toolbar indicator: pending while dirty/saving, saved when synced to disk (or pristine untitled). */
  const saveStatus = computed<"pending" | "saved">(() =>
    dirty.value || saving.value ? "pending" : "saved",
  );

  function bumpVersion() {
    documentVersion.value += 1;
  }

  function resetAutosaveFailures() {
    autosaveFailureCount = 0;
  }

  function resumeAutosaveIfNeeded() {
    if (disposed || !path.value || !dirty.value) {
      return;
    }
    scheduleAutosave();
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
      resetAutosaveFailures();
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

  async function saveExistingPath(options?: {
    quiet?: boolean;
  }): Promise<boolean> {
    const targetPath = path.value;
    if (!targetPath) {
      return false;
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
      resetAutosaveFailures();
      statusMessage.value =
        content.value === snapshot
          ? `已自动保存 ${targetName}`
          : `已自动保存 ${targetName}，仍有未保存更改`;
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (options?.quiet) {
        statusMessage.value = `自动保存失败：${detail}`;
      } else {
        await showError("保存失败", error);
      }
      return false;
    }
  }

  async function save(options?: { quiet?: boolean }): Promise<boolean> {
    return runSave(async () => {
      if (!path.value) {
        return saveAsCurrent();
      }
      return saveExistingPath(options);
    });
  }

  const scheduleAutosave = debounce(() => {
    if (disposed || !path.value || !dirty.value) {
      return;
    }
    if (saving.value) {
      void waitWhileSaving().then(() => {
        resumeAutosaveIfNeeded();
      });
      return;
    }

    const quiet = autosaveFailureCount > 0;
    void save({ quiet }).then((ok) => {
      if (disposed) {
        return;
      }
      if (ok) {
        resetAutosaveFailures();
      } else if (path.value) {
        autosaveFailureCount += 1;
        if (autosaveFailureCount >= 3) {
          statusMessage.value =
            "自动保存连续失败，已暂停；请检查文件权限后手动保存或继续编辑";
          return;
        }
      }
      resumeAutosaveIfNeeded();
    });
  }, AUTOSAVE_WAIT_MS);

  function applyLoaded(doc: {
    path: string | null;
    fileName: string;
    content: string;
    format: DocumentFormat;
  }) {
    scheduleAutosave.cancel();
    resetAutosaveFailures();
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

  async function waitWhileSaving() {
    while (saving.value) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async function flushAutosave() {
    scheduleAutosave.cancel();
    await waitWhileSaving();
    if (disposed || !path.value || !dirty.value) {
      return;
    }
    await save();
  }

  function guardDirty(): Promise<boolean> {
    if (dirtyGuardPromise) {
      return dirtyGuardPromise;
    }
    dirtyGuardPromise = (async () => {
      await flushAutosave();
      if (!dirty.value) {
        dirtyGuardPromise = null;
        return true;
      }
      dirtyDialogOpen.value = true;
      return new Promise<boolean>((resolve) => {
        dirtyResolver = resolve;
      });
    })();
    return dirtyGuardPromise;
  }

  async function onDirtySave() {
    await waitWhileSaving();
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
    scheduleAutosave.cancel();
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

  async function saveAs(): Promise<boolean> {
    scheduleAutosave.cancel();
    try {
      return await runSave(saveAsCurrent);
    } finally {
      resumeAutosaveIfNeeded();
    }
  }

  function setContent(next: string) {
    content.value = next;
    if (path.value) {
      if (autosaveFailureCount >= 3) {
        resetAutosaveFailures();
      }
      scheduleAutosave();
    }
  }

  function dispose() {
    disposed = true;
    scheduleAutosave.cancel();
  }

  return {
    path,
    fileName,
    content,
    format,
    dirty,
    saveStatus,
    title,
    documentVersion,
    statusMessage,
    dirtyDialogOpen,
    saving,
    setContent,
    guardDirty,
    flushAutosave,
    newDocument,
    openDocument,
    save,
    saveAs,
    onDirtySave,
    onDirtyDiscard,
    onDirtyCancel,
    dispose,
  };
}
