# tomark — Agent 注意事项

面向 Cursor / Agent 的项目约定。公开介绍见根目录 `readme.md`。

## 产品要点

- 轻量级跨平台 Markdown **桌面**编辑器；**Markdown 源码是唯一数据源，右侧支持受限所见即所得文字编辑**。
- 布局：左侧约 1/3 显示 Markdown 源码，右侧约 2/3 显示渲染预览。
- 右侧可编辑范围：标题、段落、列表项、引用、表格单元格中的普通文字，显式链接的显示文字，以及粗体、斜体、删除线中的普通文字。
- 右侧不可键入范围：行内代码、围栏代码块、图片、任务复选框、脚注生成内容、自动链接和 Mermaid；显式链接的 URL / title 也不得从预览区修改。无法可靠映射回源码的内容同样降级只读，并提示改用源码区。任务复选框允许普通点击切换勾选并写回源码 marker，不得键入编辑。
- Mermaid 是正式能力：`mermaid` 围栏在预览中渲染但保持只读，HTML/PNG 导出也应保留图表结果；普通点击成功图显示浮动工具栏（全屏 icon、复制源码 icon、复制图片 icon、英文 SVG、英文 PNG 白底 2×），不提供定位源码按钮；Cmd/Ctrl+点击仍定位源码，不得从预览修改围栏源码；复制源码或图片不等于批准编辑。
- Markdown 图片是正式只读查看能力：预览真实渲染图片（含相对已保存文档的本地路径）；普通点击成功图显示浮动工具栏（全屏 icon、复制图片 icon、英文 PNG，自然尺寸），不提供复制源码/SVG/定位按钮；Cmd/Ctrl+点击仍定位源码，不得从预览修改图片语法。
- 源码区粘贴图片是正式能力：优先 Web 同步/异步 clipboard 读入；WKWebView 截图等无法取得 File 时允许官方 Tauri 只读图片回退并规范化为 PNG；未命名文档须先另存为；成功后原子写入文档旁 `assets/` 并插入相对路径 `![]()`；取消另存为、读取失败或写盘失败不得改源码；纯文本粘贴不得触发原生剪贴板；不得因此批准预览编辑图片。
- 任务复选框是正式点击切换能力：editable 预览普通点击 ☐/☑ 写回 `[ ]`/`[x]`；Cmd/Ctrl+点击仍定位源码；变更进入同一撤销历史。
- HTML/PNG/PDF 导出是正式能力：支持嵌入图片 HTML、资源目录 HTML、长图 PNG 与长图不分页 PDF（位图单页，不可检索文字；超高单页在部分阅读器体验较差属已定权衡），输入为当前编辑器内容（含未保存修改）。
- 预览中的链接普通点击经系统默认浏览器打开安全外链；Cmd/Ctrl+点击继续定位源码；格式工具条「打开链接」与 Alt/Option+点击可作为等价打开路径；不得在 WebView 内导航。
- 右侧编辑与左侧源码共用同一套撤销历史：macOS 用 ⌘Z 撤销、⌘Y / ⇧⌘Z 重做；Windows / Linux 用 Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做。
- 源码区按标题（heading）范围可折叠，**打开文档时沿第一条标题链展开到正文，其余标题默认折叠**；手动展开某一标题时互斥，只保留该标题及其祖先展开；编辑过程中不要反复强制自动折叠，应保留用户已展开/折叠状态并尽量映射到新位置。
- 按住 **Cmd**（Windows / Linux 为 **Ctrl**）点击源码行，右侧预览滚动到对应渲染块；同样修饰键点击预览块时，左侧展开并滚到对应源码行。空行定位到最近的可渲染块，不要用标题文本或像素高度猜测位置。

## 技术栈约定

| 层级 | 选型 |
|------|------|
| 桌面壳 | Tauri 2 + Rust |
| 前端 | Vue 3 + TypeScript + Vite |
| 编辑器 | CodeMirror 6（自定义标题折叠 + Cmd/Ctrl 双向定位） |
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

## 开发预览（强制约定）

原则：**热更新、快启动、易排查**。日常预览用开发模式，**禁止**为了看一眼效果去跑 `tauri:build` / 生产 `build` 打包。

命令均在 `deps/` 下执行（或 `npm --prefix deps run …`）。首次或依赖变更后先：`cd deps && npm install --legacy-peer-deps`。

| 场景 | 命令 | 说明 |
|------|------|------|
| **默认推荐**：桌面壳 + 前端热更新（要文件对话框、读盘等 Tauri API，或要真窗口） | macOS/Linux：`npm run tauri:dev`；Windows：见下方 | 开发态窗口；前端走 Vite（`devUrl` ≈ `http://localhost:1420`），改 `src/` 一般 HMR；改 `src-tauri` Rust 才会增量重编壳层 |
| **更快**：只改 UI / 编辑器 / Markdown 渲染，不依赖原生 API | `npm run dev` | 仅 Vite，浏览器打开控制台即可，启动通常最快、前端报错最好查 |
| 生产构建预览（偶发） | `npm run build` 后 `npm run preview` | 验证打包后的前端静态资源，**不是**日常开发预览 |
| 发布安装包 | `npm run tauri:build` | 仅发版；慢，不作开发预览 |

Windows 原生开发预览补充（不影响 macOS/Linux 的 `npm run tauri:dev`）：

1. 前置安装 Rust stable MSVC（含 `cargo`）以及 Visual Studio 2022 Build Tools 的 **Desktop development with C++** 工作负载和 Windows SDK。
2. 从 **x64 Native Tools Command Prompt for VS 2022**（或先执行 `VsDevCmd.bat -arch=x64`）启动，确保 `cl.exe` 和 `link.exe` 来自 Visual Studio；Git for Windows 自带的 `usr/bin/link.exe` 不可用。
3. 在仓库根目录执行以下命令。`VCToolsInstallDir` 由 Visual Studio 开发者命令行提供，避免把 MSVC 版本号写死：

```bat
cd /d <仓库根目录>
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=%VCToolsInstallDir%bin\Hostx64\x64\link.exe"
deps\node_modules\.bin\tauri.cmd dev --config src-tauri\tauri.conf.json
```

Windows 端口仍为 `http://localhost:1420`；关闭桌面窗口或在启动命令窗口按 `Ctrl+C` 停止预览。若只需浏览器预览，仍使用 `npm run dev`。

选择规则（Agent 执行「运行开发预览」时遵守）：

1. 用户未指定时：默认 `tauri:dev`（本项目是桌面应用）。
2. 用户明确只要浏览器 / 只改前端：用 `npm run dev`。
3. 已有同类预览进程在跑：不要重复拉起；告知已有进程与用法即可。
4. 启动失败：先看终端报错（端口占用、依赖缺失、Rust 工具链）；缺依赖再 `npm install`，不要改去打包。
5. 长期挂起运行；向用户回报选用的命令、访问方式（窗口或 URL）与如何停掉。

快捷任务入口：`.ai/tasks/devTasks/运行开发预览.md`。

## 打包安装包

原则：按**当前设备**打出发行安装包；命令在 `deps/` 下执行（或 `npm --prefix deps run …`）。首次或依赖变更后先：`cd deps && npm install --legacy-peer-deps`。

### 版本号（强制，以 git 为准）

安装包文件名与产品版本**必须**对齐 git 中的 `vX.Y.Z`，**不要**沿用配置文件里过期的 `0.1.0` 等占位值。

解析顺序：

1. 收集候选：本地 git tag（`git describe --tags --match 'v*' --abbrev=0`），以及 `git log` 中最近一次**提交说明以 `vX.Y.Z` 开头**的版本（与「提交到git」约定一致）。
2. **取较新的那个**（按 semver 比较）。本仓库日常以提交说明递增版本；若本地仍残留更旧的 `v*` tag，不得压过更新的提交说明版本。
3. 若都没有：停止打包，提示先执行「提交到git」；禁止用配置里的旧版本硬打。

写入位置（去掉前缀 `v`，写入纯 semver，如 `1.10.1`）：

- `src-tauri/tauri.conf.json` → `version`（决定 dmg/exe 文件名中的版本段）
- `src-tauri/Cargo.toml` → `[package].version`
- `deps/package.json` 与 `deps/package-lock.json` → `version`

命令：`npm run sync:version`（`deps/sync-version-from-git.mjs`）。`npm run tauri:build` 已内置先跑同步，勿绕过。

同步可能改动上述文件；打包后若 working tree 有版本 diff，属预期，可在下次「提交到git」一并提交，不要为此单独发明版本提交。

### 平台命令与产物

| 当前设备 | 命令 | 产物 |
|----------|------|------|
| **macOS（须打两套）** | `npm run tauri:build -- --target x86_64-apple-darwin` | Intel：`src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg` |
| | `npm run tauri:build -- --target aarch64-apple-darwin` | Apple 芯片：`src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg` |
| **Windows** | x64 Native Tools 命令行中的 Windows 流程（见下方） | `src-tauri/target/release/bundle/nsis/tomark_<semver>_x64-setup.exe` |

预期文件名形态示例：`tomark_1.10.1_aarch64.dmg` / `tomark_1.10.1_x64.dmg`（版本段与当前 git `vX.Y.Z` 一致）。

Windows 打包流程：

1. 前置安装 Rust stable MSVC（含 `cargo`），以及 Visual Studio 2022 Build Tools 的 **Desktop development with C++** 工作负载和 Windows SDK。
2. 从 **x64 Native Tools Command Prompt for VS 2022** 启动（或先执行 `VsDevCmd.bat -arch=x64`），并确认 `where cl`、`where link` 指向 Visual Studio；Git for Windows 自带的 `usr/bin/link.exe` 不可作为 MSVC 链接器。
3. 在仓库根目录执行以下命令。显式设置 `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER`，避免 PATH 中其它 `link.exe` 抢先；`VCToolsInstallDir` 由 Visual Studio 开发者命令行提供：

```bat
cd /d <仓库根目录>
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=%VCToolsInstallDir%bin\Hostx64\x64\link.exe"
npm.cmd run sync:version
deps\node_modules\.bin\tauri.cmd build --config src-tauri\tauri.conf.json --bundles nsis
```

`npm run tauri:build` 在 Windows 的 `cmd.exe` 下可能受 `.bin/tauri` 路径解析影响；上面的 `tauri.cmd` 是等价的直接调用，不改变 macOS/Linux 的脚本流程。构建会先执行 `beforeBuildCommand` 生成前端资源，完成后核对 NSIS 文件名、`FileVersion`/`ProductVersion` 与本次 Git `vX.Y.Z` 一致。版本同步或 Cargo 构建产生的版本配置 / `Cargo.lock` 差异属于预期变更。

补充：

1. mac 交叉架构前确认已安装对应 Rust target，例如：`rustup target add x86_64-apple-darwin`、`rustup target add aarch64-apple-darwin`。缺则先安装再打包。
2. 本机已是 Apple 芯片时打 Intel、或本机是 Intel 时打 arm64，均属交叉编译，耗时更长，属正常。
3. 不要用 `tauri:dev` 或仅前端 `build` 代替安装包；用户要的是可分发的 dmg / exe。
4. 完成后向用户回报所用 **git 版本**（`vX.Y.Z`）与**每个**安装包的绝对路径；核对路径中的版本段是否一致。
5. 签名 / 公证未配置时，打出的包仍可用于本机或未签名分发测试；若签名失败，在回复中说明，并尽量保留已生成的未签名产物路径。
6. 若残留旧挂载卷（如 macOS `/Volumes/tomark`）导致 dmg 失败，先卸载再重打。

快捷任务入口：`.ai/tasks/devTasks/打包安装包.md`。

## 提交 release

原则：把**当前设备**上、**最新 git 版本** `vX.Y.Z` 的安装包发到 GitHub Release；远程以 `.ai/remote/` 为准。

1. 版本：与「打包安装包」相同解析规则；tag / Release 名用 `vX.Y.Z`。
2. macOS：上传该版本下的 `tomark_<semver>_aarch64.dmg` 与 `tomark_<semver>_x64.dmg`（缺哪个说明哪个未找到，不要用旧版本凑数）。
3. Windows：上传该版本 `.exe`（NSIS 等，以实际产物为准）。
4. 命令（GitHub，需已 `gh auth login`）：
   - 尚无该 Release：`gh release create vX.Y.Z <资产…> --repo <owner/name> --title 'vX.Y.Z' --notes '…'`
   - 已有同名 Release：`gh release upload vX.Y.Z <资产…> --repo <owner/name> --clobber`（仅更新本机应传资产，不要删其它平台已有包）。
5. 缺安装包时提示先执行「打包安装包」；本任务不重新打包。
6. 完成后回报 Release URL、版本号与已上传资产名。

快捷任务入口：`.ai/tasks/projectTasks/提交release.md`。

## 禁止事项

- 不要把密钥、token、内网地址写入 `readme.md` 或其它公开文档。
- 敏感与远程仓库信息只放在 `.ai/remote/` 等本地约定位置。
- 不要改动、删除或重命名 `.git/`；不要无故清空 `.ai/` 已有内容。
- 初始化 / 规划类任务不要顺手大面积生成业务代码或强制安装依赖、构建发布。
- 不要用其他目录名替代强制的 `plan/prd` 与 `plan/misc`。
- 不要把根目录当成源码垃圾桶；实现一律进模块目录。
- 不要用完整打包代替开发预览。

## 常用任务入口

- 开发类：`.ai/tasks/devTasks/`（如「初始化开发目录」「新功能开发规划」「运行开发预览」「打包安装包」「新增功能审查」）
- 规划归档：`.ai/tasks/planTasks/`（如「prd归档」——先开发后归档）
- 工程类（提交、推送、远程信息、提交 release 等）：`.ai/tasks/projectTasks/`

执行任务时以对应 `.md` 步骤为准；需求清晰时可按任务说明直接落盘，勿反复空确认。
