# tomark

轻量级跨平台 Markdown 桌面编辑器。左侧编辑源码，右侧查看渲染效果；不做所见即所得。

## 为何存在

在写 Markdown 时需要「源码清晰 + 预览可靠」的轻量工具：源码可按标题折叠浏览大纲，并能从任意源码行一键定位到右侧对应内容，减少来回滚动与猜位置的成本。

## 核心能力

- **双栏布局**：左侧约 1/3 源码，右侧约 2/3 渲染预览。
- **标题折叠**：按 Markdown 标题层级折叠源码块；打开文档时默认全部收起，可逐层展开。
- **行级定位**：源码行左侧按钮可将预览快速滚动到对应渲染块。
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
