# tomark — Agent 注意事项

面向 Cursor / Agent 的项目约定。公开介绍见根目录 `readme.md`。

## 产品要点

- 轻量级跨平台 Markdown **桌面**编辑器（非所见即所得）。
- 布局：左侧约 1/3 显示 Markdown 源码，右侧约 2/3 显示渲染预览。
- 源码区按标题（heading）范围可折叠，**打开文档时默认折叠**；编辑过程中不要反复强制自动折叠，应保留用户已展开/折叠状态并尽量映射到新位置。
- 源码每一可见行左侧提供定位按钮（gutter icon）；点击后右侧预览滚动到对应渲染块。空行定位到最近的可渲染块，不要用标题文本或像素高度猜测位置。

## 技术栈约定

| 层级 | 选型 |
|------|------|
| 桌面壳 | Tauri 2 + Rust |
| 前端 | Vue 3 + TypeScript + Vite |
| 编辑器 | CodeMirror 6（自定义标题折叠 + 行级 gutter） |
| Markdown | unified / remark（含 GFM）+ rehype-sanitize；保留 AST 源码行信息，建立 `sourceLine → previewNode` 索引 |
| 测试 | Vitest + Vue Test Utils；gutter / 滚动 / 跨平台文件操作用 Playwright 或 Tauri 冒烟预留 |

后续脚手架与依赖安装另开任务；本仓库初始化阶段不应在未规划时擅自换成 Electron / Monaco 等重栈。

## 目录职责

| 路径 | 职责 |
|------|------|
| `src/` | Vue UI、布局、CodeMirror、Markdown 管线、预览与联动；前端入口与可内收配置（`index.html`、`vite.config.mts`、`tsconfig.json`）也放这里 |
| `src-tauri/` | Tauri/Rust 窗口、文件 IO、系统能力（Rust/Tauri 源码只放这里） |
| `tests/` | 单元、集成、端到端测试与 fixtures |
| `deps/` | 依赖目录：`package.json`、`package-lock.json`、真实 `node_modules/`、`vitest.config.ts`、前端构建产物 `dist/`、Vite 缓存 `.vite-cache/`。根目录禁止出现 `package.json` / `node_modules`（含 Vite 缓存冒充的空 `node_modules`）。`src/node_modules`、`tests/node_modules` 若存在，仅为指向 `deps/node_modules` 的符号链接（供解析），勿在其下再装依赖。 |
| `plan/prd/` | 产品需求、PRD、规格说明（开发后归档；先开发再归档） |
| `plan/misc/` | 调研、纪要、原型备注等产品相关产出 |
| `.ai/` | 本地 Agent 任务与远程仓库元信息；**不要挪动或清空** |

开发相关顶层文件夹当前为：`src/`、`src-tauri/`、`tests/`、`deps/`（合计应保持在 **2–5 个**；`plan/`、`.ai/`、`.git/` 不计入）。

建议在 `src/` 内按模块拆分，例如：`app/`、`editor/`、`markdown/`、`preview/`、`native/`、`shared/`。

## 开发落盘规则（强制）

- **禁止**在仓库根目录直接新增/堆砌开发源码文件（组件、页面、业务脚本、样式、Rust 源文件、测试用例等）。
- 所有开发产出必须放入初始化后的开发目录（如 `src/`、`src-tauri/`、`tests/`、`deps/`）及其子目录。
- 根目录只保留：文档与约定（`agent.md`、`readme.md`）、`plan/`、`.ai/`、`.git/`；npm 依赖入口放在 `deps/`。根目录**禁止**出现 `package.json` / `package-lock.json` / `node_modules`（含符号链接）。
- 若现有开发目录不够用、需要新增顶层文件夹（例如 `docs-site/`、`scripts/`）：**先询问用户是否可以增加「XXX」文件夹**，征得同意后再建；不得擅自扩顶层。
- 顶层开发相关文件夹总数保持 **2–5 个**；不要为了分类把根目录拆成一排空壳目录。

## 禁止事项

- 不要把密钥、token、内网地址写入 `readme.md` 或其它公开文档。
- 敏感与远程仓库信息只放在 `.ai/remote/` 等本地约定位置。
- 不要改动、删除或重命名 `.git/`；不要无故清空 `.ai/` 已有内容。
- 初始化 / 规划类任务不要顺手大面积生成业务代码或强制安装依赖、构建发布。
- 不要用其他目录名替代强制的 `plan/prd` 与 `plan/misc`。
- 不要把根目录当成源码垃圾桶；实现一律进模块目录。

## 常用任务入口

- 开发类：`.ai/tasks/devTasks/`（如「初始化开发目录」「新功能开发规划」）
- 规划归档：`.ai/tasks/planTasks/`（如「prd归档」——先开发后归档）
- 工程类（提交、推送、远程信息等）：`.ai/tasks/projectTasks/`

执行任务时以对应 `.md` 步骤为准；需求清晰时可按任务说明直接落盘，勿反复空确认。
