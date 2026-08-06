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
| `src/` | Vue UI、布局、CodeMirror、Markdown 管线、预览与联动 |
| `src-tauri/` | Tauri/Rust 窗口、文件 IO、系统能力 |
| `tests/` | 单元、集成、端到端测试与 fixtures |
| `plan/prd/` | 产品需求、PRD、规格说明 |
| `plan/misc/` | 调研、纪要、原型备注等产品相关产出 |
| `.ai/` | 本地 Agent 任务与远程仓库元信息；**不要挪动或清空** |

建议在 `src/` 内按模块拆分（实现阶段再落盘），例如：`app/`、`editor/`、`markdown/`、`preview/`、`native/`、`shared/`。

## 禁止事项

- 不要把密钥、token、内网地址写入 `readme.md` 或其它公开文档。
- 敏感与远程仓库信息只放在 `.ai/remote/` 等本地约定位置。
- 不要改动、删除或重命名 `.git/`；不要无故清空 `.ai/` 已有内容。
- 初始化 / 规划类任务不要顺手大面积生成业务代码或强制安装依赖、构建发布。
- 不要用其他目录名替代强制的 `plan/prd` 与 `plan/misc`。

## 常用任务入口

- 开发类：`.ai/tasks/devTasks/`
- 工程类（提交、推送、远程信息等）：`.ai/tasks/projectTasks/`

执行任务时以对应 `.md` 步骤为准；需求清晰时可按任务说明直接落盘，勿反复空确认。
