# Agent Governance Kit v0.1

面向 Codex、Cursor 及其他编码 Agent 的项目治理控制面最小可移植内核。

本版本解决四个问题：

1. 用机器可读对象记录项目语义、责任、合同、工作包和证据；
2. 用 `AGENTS.md` 与 Skills 引导 Agent 采用统一工作方式；
3. 用任务信封约束多 Agent 的职责、范围和停止条件；
4. 用本地校验脚本检查包结构和项目治理数据的基本一致性。

## 快速开始

```powershell
python scripts/bootstrap_project.py --target E:\path\to\project --mode existing
python scripts/validate_package.py
python scripts/audit_project.py --target E:\path\to\project
```

`mode` 可取：

- `new`：全新项目，先定义语义再开发；
- `existing`：存量项目，先建立候选 Inventory，不把扫描结果直接当作业务事实。

## 包含内容

- `agent-integration/common/AGENTS.md.template`：仓库级 Agent 入口；
- `agent-integration/common/skills/`：六个治理工作流；
- `agent-integration/common/role-contracts/`：架构、实现、验收角色合同；
- `schemas/`：治理清单、任务信封、语义地图和证据的 JSON Schema；
- `project-template/`：可复制到目标项目的治理目录；
- `mcp/contract.md`：未来治理 MCP 的稳定工具合同；
- `scripts/`：初始化及最小审计脚本。

## v0.1 边界

当前版本提供文件型控制面，不包含数据库、Web 前端和可运行 MCP Server。`audit_project.py` 只证明结构、引用和必填字段，不证明业务定义本身正确，也不代替运行态 E2E。

