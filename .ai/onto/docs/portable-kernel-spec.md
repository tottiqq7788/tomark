# 项目治理控制面可移植内核规范 v0.1

## 1. 目标

治理内核是业务系统之外的控制面。它保存项目为什么这样设计、由谁负责、代码在哪里实现、如何验证，以及一次修改可能影响什么。

它不得把自然语言文档、代码扫描结果或测试通过单独当作完整真相。

## 2. 六类核心对象

| 对象 | 权威含义 | 最低要求 |
|---|---|---|
| Semantic Rule | 必须成立或必须禁止的稳定语义 | 稳定 ID、陈述、来源、状态 |
| Responsibility | 模块和角色承担的责任 | L0 引用、owner、reviewer |
| Contract | 实现必须遵守的边界 | 正向、负向、证据要求 |
| Inventory | 某个不可变基线的客观现状 | baseline commit、来源、置信度 |
| Work Package | 从现状到目标的一次受控变更 | 范围、停止条件、验收证据 |
| Evidence | 支持某项结论的可复验证据 | commit、证据类型、结果、限制 |

## 3. 关系

```text
source requirement -> semantic rule (L0)
semantic rule -> responsibility (L1)
responsibility -> implementation selector (L2)
contract -> constrains work package
inventory -> discovers candidate gap
work package -> changes implementation
evidence -> proves or limits work package closeout
```

所有引用使用稳定 ID。删除对象前必须检查反向引用；修改 L0 必须重新计算 L1、L2、合同、测试及运行态证据影响。

## 4. 权威边界

- 自然语言需求是来源，不是自动执行规则；
- Inventory 是带时间和基线的观察结果，不是永久真相；
- 合同定义边界，不证明代码已经符合；
- 测试证明指定场景，不自动证明所有运行场景；
- 只有绑定不可变 commit 的证据才能用于阶段 closeout；
- 缺少 E2E 时必须明确为证据缺口。

## 5. 接入模式

### 5.1 全新项目

先建立 L0，再划分 L1，最后登记 L2 候选边界。实现只能由已批准工作包启动。

### 5.2 存量项目

先扫描生成候选 Inventory，再由人或授权 Agent 确认业务语义。扫描器不得根据代码现状自动创造 L0。

## 6. Agent 工作协议

Agent 必须通过任务信封接收受治理任务。任务信封至少包含角色、基线、允许范围、L0 判断、必须保持、必须禁止、证据要求和停止条件。

`AGENTS.md` 只保存入口、命令和硬约束；详细流程放入 Skills；动态事实由 CLI 或 MCP 查询；强制规则由 Hooks/CI 执行。

## 7. v0.1 闭环条件

- Schema 可解析；
- 示例数据通过 Schema 和引用检查；
- 六个 Skills 通过结构验证；
- 初始化脚本能够在空目录建立治理骨架；
- 新项目和存量项目具有不同接入状态；
- 工具不得把静态检查表述为生产运行证明。

