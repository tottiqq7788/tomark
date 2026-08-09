# Governance MCP Contract v0.1

本文件冻结未来 MCP Server 的工具语义；v0.1 不提供虚假的可运行服务。

| 工具 | 输入要点 | 输出要点 | 是否写入 |
|---|---|---|---|
| `get_project_context` | project、task | 相关规则、责任、合同 | 否 |
| `get_semantic_rule` | rule_id | 规则、来源、关系 | 否 |
| `get_active_work_package` | package_id | 基线、范围、证据要求 | 否 |
| `analyze_change_impact` | baseline、paths、intent | L0/L1/L2 候选影响 | 否 |
| `check_rule_conflicts` | rule ids 或 candidate | 冲突及不确定项 | 否 |
| `register_implementation` | task envelope、commit | 实现登记 | 是 |
| `submit_evidence` | evidence envelope | 证据登记 | 是 |
| `audit_current_change` | baseline、current | 违规与证据缺口 | 否 |
| `close_work_package` | package_id、commit | closeout 结果 | 是 |

写工具必须具备版本前置条件、幂等键和审计主体；冲突时不得静默覆盖。影响分析输出是候选结论，修改 L0 仍需授权角色批准。

