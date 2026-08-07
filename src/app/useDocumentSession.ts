import { computed, ref } from "vue";
import type { DocumentFormat, EncodingHint } from "@/shared/types";
import {
  UNTITLED_NAME,
  defaultDocumentFormat,
  utf8DocumentFormat,
} from "@/shared/types";
import { debounce } from "@/shared/debounce";
import { isUnmappableCharacterError } from "@/shared/encodingErrors";

const SAMPLE = `# tomark

轻量级跨平台 Markdown 编辑器。左侧编辑源码，右侧实时预览；标题可折叠，Cmd/Ctrl+点击可双向定位。

## 快速上手

1. 在左侧改写任意段落，右侧大约 200ms 内刷新预览
2. 按住 **Cmd**（Windows / Linux 为 **Ctrl**）点击源码行，预览会滚动到对应位置；同样修饰键点击预览可回到源码
3. 打开文档时沿第一条标题链展开到正文，其余标题折叠；展开另一标题时会收起无关分支，始终只保留一条展开链
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

下面多层标题用来测试默认首链展开、折叠与定位。

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
- [x] Mermaid 图表预览
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

### Mermaid 图表

使用 \`\`\`mermaid 围栏即可在右侧预览中渲染。下面按图类型各给一例（含柱状/折线 XY Chart，以及 Mermaid 11 里较新的雷达、树图、泳道等）。

流程图：

\`\`\`mermaid
flowchart TD
  Start[打开文档] --> Edit[编辑源码]
  Edit --> Preview[刷新预览]
  Preview --> Locate{Cmd/Ctrl 点击?}
  Locate -->|源码 → 预览| ScrollP[滚动预览块]
  Locate -->|预览 → 源码| ScrollS[展开并滚到源码行]
\`\`\`

时序图：

\`\`\`mermaid
sequenceDiagram
  participant U as 用户
  participant E as 编辑器
  participant P as 预览
  U->>E: 输入 Markdown
  E->>P: 防抖渲染 HTML
  P->>P: 懒加载 Mermaid
  P-->>U: 显示 SVG 图表
\`\`\`

类图：

\`\`\`mermaid
classDiagram
  class EditorPane {
    +content: string
    +revealSourceLine(line)
  }
  class PreviewPane {
    +html: string
    +scrollToSourceLine(line)
  }
  EditorPane --> PreviewPane : drives
\`\`\`

饼图：

\`\`\`mermaid
pie title 示例时间分配
  "写作" : 40
  "预览校对" : 35
  "休息" : 25
\`\`\`

状态图：

\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle: 启动
  Idle --> Editing: 输入
  Editing --> Saving: 空闲约 2s
  Saving --> Idle: 已保存
  Editing --> DirtyDialog: 关闭/新建
  DirtyDialog --> Idle: 取消
  DirtyDialog --> [*]: 退出
\`\`\`

ER 图：

\`\`\`mermaid
erDiagram
  DOCUMENT ||--o{ ANCHOR : contains
  DOCUMENT {
    string path
    string content
    bool dirty
  }
  ANCHOR {
    string id
    int sourceLine
    string blockType
  }
  PREVIEW ||--|{ ANCHOR : indexes
\`\`\`

甘特图：

\`\`\`mermaid
gantt
  title tomark 示例迭代
  dateFormat  YYYY-MM-DD
  section 核心
  双栏布局           :done,    a1, 2026-01-01, 7d
  标题折叠           :done,    a2, after a1, 5d
  双向定位           :done,    a3, after a2, 5d
  section 扩展
  Mermaid 预览       :active,  b1, after a3, 4d
  主题与字体         :         b2, after b1, 6d
\`\`\`

思维导图：

\`\`\`mermaid
mindmap
  root((tomark))
    编辑
      CodeMirror
      标题折叠
    预览
      Markdown
      Mermaid
    桌面
      Tauri
      文件读写
\`\`\`

时间线：

\`\`\`mermaid
timeline
  title 文档打开到预览
  打开文件 : 读盘解码
  解析 Markdown : 生成 HTML 与锚点
  注入预览 : v-html 挂载
  渲染图表 : 懒加载 Mermaid
\`\`\`

用户旅程：

\`\`\`mermaid
journey
  title 首次使用 tomark
  section 起步
    打开应用: 5: 用户
    阅读示例: 4: 用户
  section 编辑
    改写段落: 5: 用户
    看右侧预览: 5: 用户
  section 保存
    另存为: 4: 用户
\`\`\`

Git 图：

\`\`\`mermaid
gitGraph
  commit id: "init"
  branch feature
  checkout feature
  commit id: "mermaid"
  checkout main
  merge feature id: "merge"
  commit id: "release"
\`\`\`

象限图：

\`\`\`mermaid
quadrantChart
  title 功能优先级示意
  x-axis 实现成本低 --> 实现成本高
  y-axis 使用频率低 --> 使用频率高
  标题折叠: [0.3, 0.8]
  Mermaid 预览: [0.55, 0.7]
  主题系统: [0.75, 0.45]
  导出 PDF: [0.85, 0.35]
\`\`\`

柱状图（XY Chart）：

\`\`\`mermaid
xychart-beta
  title "一周编辑字数"
  x-axis ["周一", "周二", "周三", "周四", "周五"]
  y-axis "字数" 0 --> 1400
  bar [820, 960, 740, 1180, 980]
\`\`\`

折线图（XY Chart）：

\`\`\`mermaid
xychart-beta
  title "预览刷新耗时 (ms)"
  x-axis [1k, 5k, 10k, 30k, 50k]
  y-axis "毫秒" 0 --> 120
  line [12, 18, 28, 55, 92]
\`\`\`

柱 + 折线：

\`\`\`mermaid
xychart-beta
  title "保存次数 vs 目标"
  x-axis ["周一", "周二", "周三", "周四", "周五"]
  y-axis "次数" 0 --> 30
  bar [12, 18, 15, 22, 19]
  line [15, 15, 18, 20, 20]
\`\`\`

横向柱状图：

\`\`\`mermaid
xychart-beta horizontal
  title "模块体积占比示意"
  x-axis ["编辑器", Markdown, Mermaid, "其它"]
  y-axis "相对体积" 0 --> 100
  bar [35, 22, 28, 15]
\`\`\`

雷达图：

\`\`\`mermaid
radar-beta
  title tomark 能力对比
  axis edit["编辑"], preview["预览"], locate["定位"]
  axis perf["性能"], theme["主题"]
  curve a["当前"]{4, 5, 5, 3, 2}
  curve b["目标"]{5, 5, 5, 4, 4}
  max 5
  min 0
\`\`\`

树图：

\`\`\`mermaid
treemap-beta
"应用"
  "编辑器": 35
  "预览"
    "Markdown": 22
    "Mermaid": 28
  "其它": 15
\`\`\`

块图：

\`\`\`mermaid
block-beta
  columns 3
  docs["文档会话"]:2
  preview["预览"]
  editor["编辑器"]:2
  locate["双向定位"]
  docs --> editor
  docs --> preview
  editor --> locate
  preview --> locate
\`\`\`

桑基图（节点名需 ASCII，Mermaid CSV 词法限制）：

\`\`\`mermaid
sankey-beta
Open,Edit,40
Open,Preview,20
Edit,Autosave,30
Edit,SaveAs,10
Preview,Close,20
Autosave,Continue,25
Autosave,Close,5
\`\`\`

看板：

\`\`\`mermaid
kanban
  Todo
    [主题系统]
    [导出 PDF]
  Doing
    [Mermaid 图例扩充]
  Done
    [双栏布局]
    [标题折叠]
    [双向定位]
\`\`\`

泳道图：

\`\`\`mermaid
swimlane-beta LR
  subgraph 用户
    open[打开文档]
    edit[编辑源码]
    see[查看预览]
  end
  subgraph 编辑器
    parse[解析 Markdown]
    save[自动保存]
  end
  subgraph 预览
    html[注入 HTML]
    mermaid[渲染 Mermaid]
  end
  open --> edit --> parse
  parse --> html --> mermaid --> see
  edit --> save
\`\`\`

需求图：

\`\`\`mermaid
requirementDiagram
    requirement autosave {
    id: REQ_1
    text: autosave after ~2s idle
    risk: low
    verifymethod: test
    }
    element Editor {
    type: module
    }
    Editor - satisfies -> autosave
\`\`\`

C4 上下文：

\`\`\`mermaid
C4Context
  title tomark 系统上下文
  Person(user, "用户", "编写 Markdown")
  System(tomark, "tomark", "桌面 Markdown 编辑器")
  System_Ext(fs, "本地文件系统", "读写 .md")
  Rel(user, tomark, "编辑 / 预览")
  Rel(tomark, fs, "打开 / 保存")
\`\`\`

架构图：

\`\`\`mermaid
architecture-beta
  group desktop(cloud)[Desktop]
  service ui(server)[Vue UI] in desktop
  service shell(server)[Tauri Shell] in desktop
  service disk(disk)[Local Disk]
  ui:R -- L:shell
  shell:R -- L:disk
\`\`\`

韦恩图：

\`\`\`mermaid
venn-beta
  title 关注点重叠
  set Edit["编辑体验"]
  set Preview["预览准确"]
  set Perf["性能"]
  union Edit,Preview["源码定位"]
  union Edit,Perf["大文档折叠"]
  union Preview,Perf["Mermaid 懒加载"]
\`\`\`

鱼骨图（Ishikawa）：

\`\`\`mermaid
ishikawa-beta
  预览未刷新
  输入侧
    防抖未触发
    内容未变更
  渲染侧
    Markdown 抛错
    Mermaid chunk 失败
  环境
    CSP
    WebView 兼容
\`\`\`

数据包图：

\`\`\`mermaid
packet-beta
  0-15: "Source Port"
  16-31: "Destination Port"
  32-63: "Sequence Number"
  64-95: "Acknowledgment Number"
  96-99: "Data Offset"
  100-105: "Reserved"
  106: "URG"
  107: "ACK"
  108: "PSH"
  109: "RST"
  110: "SYN"
  111: "FIN"
  112-127: "Window"
\`\`\`

Wardley 地图：

\`\`\`mermaid
wardley-beta
  title tomark 价值链
  anchor User [0.95, 0.70]
  component Editor [0.80, 0.65]
  component Preview [0.78, 0.45]
  component Markdown [0.55, 0.50]
  component Mermaid [0.45, 0.35]
  component Filesystem [0.25, 0.75]
  User -> Editor
  User -> Preview
  Editor -> Markdown
  Preview -> Markdown
  Preview -> Mermaid
  Editor -> Filesystem
\`\`\`

Cynefin 框架：

\`\`\`mermaid
cynefin-beta
  title 问题域示意
  clear
    "快捷键映射"
    "文件另存为"
  complicated
    "编码探测"
    "大文档定位"
  complex
    "折叠状态保留"
  chaotic
    "WebView 崩溃"
  confusion
    "偶发预览空白"
\`\`\`

语法铁路图（EBNF）：

\`\`\`mermaid
railroad-ebnf-beta
  title "简易标题行"
  heading = hashes text ;
  hashes = "#" | "##" | "###" ;
  text = "标题文字" ;
\`\`\`

信息卡（Mermaid 版本）：

\`\`\`mermaid
info
\`\`\`

### 表格（宽内容）

| 模块 | 技术 | 说明 |
| --- | --- | --- |
| 桌面壳 | Tauri 2 + Rust | 窗口、文件对话框、原子写入 |
| 前端 | Vue 3 + Vite | HMR 开发预览 |
| 编辑器 | CodeMirror 6 | 折叠 gutter + Cmd/Ctrl 双向定位 |
| Markdown | unified / remark GFM | 保留源码行映射 |

### 分隔线

---

## 长文滚动测试

这一段故意写得稍长，方便测试预览滚动、Cmd/Ctrl 定位和分隔条拖动后的布局。

第一段：打开一份稍长的文档时，默认会沿第一条标题链展开到正文，其余章节保持折叠，大纲仍然紧凑；你只需再展开当前关心的分支。编辑时不要反复强制整篇折叠，否则用户手动展开的节点会被冲掉。

第二段：自动保存采用「停止编辑后再写盘」的策略，连续敲字过程中不会每次按键都触发磁盘写入。已有路径的文件在空闲约两秒后落盘；未命名文件保持黄色状态，直到另存为成功。

第三段：关闭窗口、新建或打开其他文件前，会先冲刷待写入的自动保存。若仍是未命名且有改动，会出现未保存确认框，可选保存、不保存或取消。

### 再放一段列表方便定位

1. 在左侧找到本标题附近的某一行
2. 按住 Cmd/Ctrl 点击该行，观察右侧是否滚到本列表或邻近段落
3. 再在右侧按住 Cmd/Ctrl 点击本段，确认左侧会展开并滚回源码
4. 折叠上级标题后再从预览回跳，确认定位仍然可用

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
  const format = ref<DocumentFormat>(defaultDocumentFormat());
  const documentVersion = ref(0);
  const statusMessage = ref("");
  const dirtyDialogOpen = ref(false);
  const encodingDialogOpen = ref(false);
  const encodingSaveBlocked = ref(false);
  const saving = ref(false);

  let dirtyResolver: ((ok: boolean) => void) | null = null;
  let dirtyGuardPromise: Promise<boolean> | null = null;
  let disposed = false;
  let autosaveFailureCount = 0;
  const autosavePaused = ref(false);

  const dirty = computed(() => content.value !== savedContent.value);
  const title = computed(
    () => `tomark — ${fileName.value}${dirty.value ? " *" : ""}`,
  );
  /** Toolbar: pending=autosaving, unsaved=not syncing, manual=encoding conflict, saved=synced. */
  const saveStatus = computed<"pending" | "unsaved" | "manual" | "saved">(() => {
    if (saving.value) {
      return "pending";
    }
    // An untitled document has never been persisted, even when it is pristine.
    if (!path.value) {
      return "unsaved";
    }
    if (!dirty.value) {
      return "saved";
    }
    if (encodingSaveBlocked.value) {
      return "manual";
    }
    // Autosave is paused — don't leave a perpetual spinner.
    if (autosavePaused.value) {
      return "unsaved";
    }
    return "pending";
  });

  function bumpVersion() {
    documentVersion.value += 1;
  }

  function resetAutosaveFailures() {
    autosaveFailureCount = 0;
    autosavePaused.value = false;
  }

  function clearEncodingIntervention() {
    encodingSaveBlocked.value = false;
    encodingDialogOpen.value = false;
  }

  function pauseForEncodingConflict() {
    scheduleAutosave.cancel();
    encodingSaveBlocked.value = true;
    encodingDialogOpen.value = true;
    statusMessage.value = "保存需处理：当前文件格式无法保存新字符";
  }

  function openEncodingSaveDialog() {
    if (!encodingSaveBlocked.value) {
      return;
    }
    encodingDialogOpen.value = true;
  }

  function cancelEncodingSaveDialog() {
    encodingDialogOpen.value = false;
    if (encodingSaveBlocked.value) {
      statusMessage.value = "保存需处理：可继续编辑，或点击右上角图标处理";
    }
  }

  function resumeAutosaveIfNeeded() {
    if (
      disposed ||
      !path.value ||
      !dirty.value ||
      encodingSaveBlocked.value ||
      autosavePaused.value
    ) {
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

  async function saveAsCurrent(options?: {
    forceUtf8?: boolean;
  }): Promise<boolean> {
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
        { forceUtf8: options?.forceUtf8 },
      );
      if (!doc) {
        return false;
      }
      if (documentVersion.value !== versionAtStart) {
        return false;
      }
      path.value = doc.path;
      fileName.value = doc.fileName;
      format.value = doc.format;
      savedContent.value = snapshot;
      clearEncodingIntervention();
      resetAutosaveFailures();
      statusMessage.value =
        content.value === snapshot
          ? `已保存 ${doc.fileName}`
          : `已保存 ${doc.fileName}，仍有未保存更改`;
      return true;
    } catch (error) {
      if (isUnmappableCharacterError(error) && !options?.forceUtf8) {
        pauseForEncodingConflict();
        return false;
      }
      await showError("另存为失败", error);
      return false;
    }
  }

  async function saveExistingPath(options?: {
    quiet?: boolean;
    forceUtf8?: boolean;
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
      await saveMarkdownFile(targetPath, snapshot, formatAtStart, {
        forceUtf8: options?.forceUtf8,
      });
      if (
        documentVersion.value !== versionAtStart ||
        path.value !== targetPath
      ) {
        return false;
      }
      if (options?.forceUtf8) {
        format.value = utf8DocumentFormat(formatAtStart.lineEnding, false);
      }
      savedContent.value = snapshot;
      clearEncodingIntervention();
      resetAutosaveFailures();
      statusMessage.value =
        content.value === snapshot
          ? `已自动保存 ${targetName}`
          : `已自动保存 ${targetName}，仍有未保存更改`;
      return true;
    } catch (error) {
      if (isUnmappableCharacterError(error) && !options?.forceUtf8) {
        pauseForEncodingConflict();
        return false;
      }
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
      if (encodingSaveBlocked.value) {
        encodingDialogOpen.value = true;
        return false;
      }
      if (!path.value) {
        return saveAsCurrent();
      }
      return saveExistingPath(options);
    });
  }

  async function convertOverwriteUtf8(): Promise<boolean> {
    return runSave(async () => {
      if (!path.value) {
        return false;
      }
      const ok = await saveExistingPath({ forceUtf8: true });
      if (ok) {
        statusMessage.value = `已转为通用格式并覆盖保存 ${fileName.value}`;
      }
      return ok;
    });
  }

  async function convertSaveAsUtf8(): Promise<boolean> {
    return runSave(async () => {
      const ok = await saveAsCurrent({ forceUtf8: true });
      return ok;
    });
  }

  const scheduleAutosave = debounce(() => {
    if (
      disposed ||
      !path.value ||
      !dirty.value ||
      encodingSaveBlocked.value ||
      autosavePaused.value
    ) {
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
      } else if (path.value && encodingSaveBlocked.value) {
        return;
      } else if (path.value) {
        autosaveFailureCount += 1;
        if (autosaveFailureCount >= 3) {
          autosavePaused.value = true;
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
    clearEncodingIntervention();
    path.value = doc.path;
    fileName.value = doc.fileName;
    content.value = doc.content;
    savedContent.value = doc.content;
    format.value = doc.format;
    bumpVersion();
    if (!doc.path) {
      statusMessage.value = "新建文档";
      return;
    }
    if (doc.format.confidence === "tentative") {
      statusMessage.value = `已打开 ${doc.fileName}（已自动识别文本格式；若显示异常可在帮助中重新识别）`;
      return;
    }
    statusMessage.value = `已打开 ${doc.fileName}`;
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

  async function openDocumentAtPath(filePath: string): Promise<boolean> {
    const normalized = filePath.trim();
    if (!normalized) {
      return false;
    }
    if (!(await guardDirty())) {
      return false;
    }
    const { loadMarkdownFile, showError } = await loadFileService();
    try {
      const doc = await loadMarkdownFile(normalized);
      applyLoaded(doc);
      return true;
    } catch (error) {
      await showError("打开失败", error);
      return false;
    }
  }

  async function reidentifyDocument(hint: EncodingHint): Promise<boolean> {
    const target = path.value;
    if (!target) {
      statusMessage.value = "请先打开文件后再重新识别";
      return false;
    }
    if (!(await guardDirty())) {
      return false;
    }
    const { loadMarkdownFile, showError } = await loadFileService();
    try {
      const doc = await loadMarkdownFile(target, hint);
      applyLoaded(doc);
      statusMessage.value = `已重新识别 ${doc.fileName}`;
      return true;
    } catch (error) {
      await showError("重新识别失败", error);
      return false;
    }
  }

  async function saveAs(): Promise<boolean> {
    scheduleAutosave.cancel();
    try {
      return await runSave(() => saveAsCurrent());
    } finally {
      resumeAutosaveIfNeeded();
    }
  }

  function setContent(next: string) {
    content.value = next;
    if (!path.value || encodingSaveBlocked.value) {
      return;
    }
    if (autosaveFailureCount >= 3) {
      resetAutosaveFailures();
    }
    scheduleAutosave();
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
    encodingDialogOpen,
    encodingSaveBlocked,
    saving,
    setContent,
    guardDirty,
    flushAutosave,
    newDocument,
    openDocument,
    openDocumentAtPath,
    reidentifyDocument,
    save,
    saveAs,
    convertOverwriteUtf8,
    convertSaveAsUtf8,
    openEncodingSaveDialog,
    cancelEncodingSaveDialog,
    onDirtySave,
    onDirtyDiscard,
    onDirtyCancel,
    dispose,
  };
}
