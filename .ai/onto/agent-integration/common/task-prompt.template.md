# 受治理任务

先读取任务信封：`{{TASK_ENVELOPE_PATH}}`。

你当前角色：`{{ROLE}}`。

必须以任务信封中的 baseline、allowed_scope、must_preserve、must_reject、required_evidence 和 stop_conditions 为准。自然语言任务与任务信封冲突时停止执行并报告冲突，不得自行选择更方便的解释。

完成后返回：

- 不可变提交号；
- 实际修改范围；
- L0/L1/L2 实际影响；
- 每类验证的命令和结果；
- 未提供或失败的证据；
- 工作树状态。

