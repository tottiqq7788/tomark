# tomark

轻量级跨平台 Markdown 桌面编辑器。Markdown 源码是唯一数据源，右侧支持受限所见即所得文字编辑。

## 为何存在

在写 Markdown 时需要「源码清晰 + 预览可靠」的轻量工具：源码可按标题折叠浏览大纲，也能在渲染结果中直接修改支持的文字，并从任意源码行一键定位到右侧对应内容，减少来回滚动与猜位置的成本。

## 核心能力

- **双栏布局**：左侧约 1/3 Markdown 源码，右侧约 2/3 渲染结果。
- **受限所见即所得文字编辑**：可直接编辑标题、段落、列表项、引用、表格单元格中的普通文字，也可编辑显式链接的显示文字及粗体、斜体、删除线中的普通文字；变更写回唯一的 Markdown 源码。
- **明确的只读边界**：行内代码、围栏代码块、图片、任务复选框、脚注生成内容、自动链接和 Mermaid 在右侧只读；显式链接的 URL / title 也只能在源码区修改。无法可靠映射回源码的内容会保持只读。
- **Mermaid 图表**：将 `mermaid` 围栏渲染为只读图表，并在 HTML/PNG 导出中保留图表结果；点击图表可显示工具栏，支持全屏查看、单图 PNG/SVG 导出、复制源码与定位源码。
- **HTML/PNG 导出**：使用当前编辑器内容（包括未保存修改）导出嵌入图片 HTML、资源目录 HTML 或长图 PNG。
- **链接交互**：普通点击链接用于放置光标；Cmd/Ctrl+点击仍定位源码。使用浮动工具条「打开链接」，或 Alt/Option+点击可直接打开链接。
- **统一撤销历史**：左右两侧编辑共用同一套历史。macOS 用 ⌘Z 撤销、⌘Y / ⇧⌘Z 重做；Windows / Linux 用 Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做。
- **标题折叠**：按 Markdown 标题层级折叠源码块；打开文档时沿首条标题链展开到正文，其余默认折叠；手动展开互斥为单路径。
- **双向定位**：按住 Cmd（Windows / Linux 为 Ctrl）点击源码行可定位到预览；同样修饰键点击预览可展开并定位到源码。
- **单文件编辑**：新建、打开、保存、另存为，以及未保存变更提示。

## 技术栈概览

- **桌面**：Tauri 2 + Rust
- **前端**：Vue 3 + TypeScript + Vite
- **编辑器**：CodeMirror 6
- **Markdown**：unified / remark（GFM）+ 安全渲染（rehype-sanitize）
- **测试**：Vitest + Vue Test Utils

## 目录说明

```text
tomark/
├── src/           # 前端源码 + Vite/TS 入口配置
├── src-tauri/     # Tauri / Rust 桌面壳与原生能力
├── tests/         # 测试与 fixtures
├── deps/          # 依赖：package.json、lockfile、node_modules、构建产物
├── plan/
│   ├── prd/
│   └── misc/
├── agent.md
└── readme.md
```

开发源码进 `src/` / `src-tauri/` / `tests/`；npm 依赖进 `deps/`。根目录不堆业务或依赖文件。

## 如何开始

前置：Node.js、Rust（含 Cargo）、本机 Tauri 系统依赖（macOS 通常已具备）。

```bash
cd deps
npm install --legacy-peer-deps
npm run tauri:dev
```

也可在仓库根目录用前缀命令：

```bash
npm --prefix deps install --legacy-peer-deps
npm --prefix deps run tauri:dev
```

常用命令（均在 `deps/` 下，或加 `npm --prefix deps`）：

```bash
npm run dev          # 仅前端 Vite 开发服务器
npm test             # 单元 / 组件测试
npm run build        # 前端生产构建
npm run tauri:build  # 打包桌面应用
```

贡献与协作约定见 [`agent.md`](./agent.md)。产品细节可写入 [`plan/prd/`](./plan/prd/)。
