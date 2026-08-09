# 项目级 Agent 工作约定

本仓库使用项目治理控制面。机器可读治理对象是项目事实入口，本文件只提供工作协议，不重复业务规则。

## 权威入口

- 治理清单：`architecture/governance.json`
- 语义地图：`architecture/traceability/semantic-map.json`
- 架构合同：`architecture/contracts/`
- Inventory：`architecture/inventories/`
- 工作包：`architecture/work-packages/`
- 证据：`architecture/evidence/`

## tomark 当前治理状态

- 本仓库按存量项目接入，冻结发现基线见 `architecture/governance.json`。
- 语义地图同时包含 `approved`、`candidate` 与 `rejected` L0；只有 `approved` 规则可作为已授权产品定义，候选 L1/L2 与合同仍须独立审查。
- 冻结基线观察见 `architecture/inventories/baseline-046e97e.json`；Inventory 只描述该 commit 上的观察，不是永久真相。
- 仓库布局、依赖位置、开发预览和发布硬约束继续以 `agent.md` 为入口；本文件不复制这些动态细节。
- `DEC-TMK-20260809-001` 已批准：预览允许在可靠映射范围内直接键入；Mermaid 是正式只读渲染能力；HTML/PNG 导出是正式能力。
- `DEC-TMK-20260809-002` / `L0-TMK-018` 已批准：成功渲染的 Mermaid 支持只读查看工具栏（全屏、单图 PNG 白底 2×）；Cmd/Ctrl+点击仍定位源码。实现见 `WP-MERMAID-VIEWER-001`。
- 冻结基线的预览实现仍为不可键入投影。不得把现状表述为已符合直接键入语义；直接键入须按专用工作包准入。
- Mermaid 查看器实现不得写回围栏源码，不得绕过原生保存对话框。

## 开发前准入

任何可能改变业务语义、权限、生命周期、数据归属、跨模块写入、Agent 上下文或持久化执行的任务，都必须声明以下结论之一：

1. 不影响 L0；
2. 修改已有 L0；
3. 新增 L0。

影响 L0 时，必须先明确阶段、角色、业务对象、不变量、禁止结果、L1 责任、L2 组件和所需证据。没有已批准工作包时不得实现。

## 实现协议

- 只修改任务信封与工作包声明的范围；
- 发现实际影响超出声明时，立即停止扩展并重新准入；
- 不得绕过统一授权、状态迁移、权威写入和审计边界；
- 不得用兼容分支隐藏业务语义冲突；
- 不得把已委派实现等同于已完成架构审查。

## 验收协议

- 比较声明影响和实际影响；
- 检查未映射的相关路径；
- 区分静态扫描、契约测试、单元/集成测试和运行态 E2E；
- 证据必须绑定不可变 commit；
- 缺少、失败或跳过的证据必须明确报告。

## 常用命令

```text
python3 .ai/onto/scripts/validate_package.py
python3 architecture/tools/audit_project.py --target .
```

