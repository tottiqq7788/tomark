# tomark

轻量级跨平台 Markdown 桌面编辑器。左侧编辑源码，右侧查看渲染效果；不做所见即所得。

## 为何存在

在写 Markdown 时需要「源码清晰 + 预览可靠」的轻量工具：源码可按标题折叠浏览大纲，并能从任意源码行一键定位到右侧对应内容，减少来回滚动与猜位置的成本。

## 核心能力（规划）

- **双栏布局**：左侧约 1/3 源码，右侧约 2/3 渲染预览。
- **标题折叠**：按 Markdown 标题层级折叠源码块，打开文档时默认折叠。
- **行级定位**：源码行左侧按钮可将预览快速滚动到对应渲染块。

## 技术栈概览

- **桌面**：Tauri 2 + Rust
- **前端**：Vue 3 + TypeScript + Vite
- **编辑器**：CodeMirror 6
- **Markdown**：unified / remark（GFM）+ 安全渲染（rehype-sanitize）
- **测试**：Vitest 等（脚手架阶段再接入）

## 目录说明

```text
tomark/
├── src/           # 前端：UI、编辑器、Markdown 管线、预览联动
├── src-tauri/     # Tauri / Rust 桌面壳与原生能力
├── tests/         # 测试与 fixtures
├── plan/
│   ├── prd/       # 产品需求与规格
│   └── misc/      # 调研、纪要等
├── agent.md       # 给 AI / Agent 的项目约定
└── readme.md      # 本文件
```

## 如何开始

当前仓库处于**规划与目录初始化**阶段，尚未生成完整 Tauri / Vite 脚手架，也尚未安装依赖。

后续接入脚手架后，预期会通过包管理器与 Tauri CLI 在本地启动开发窗口；具体命令将随脚手架一并补充到本文件。

贡献与协作约定见 [`agent.md`](./agent.md)。产品细节可写入 [`plan/prd/`](./plan/prd/)。
