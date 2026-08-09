# Codex 接入映射

复制关系：

```text
common/AGENTS.md.template   -> <repo>/AGENTS.md
common/skills/*             -> <repo>/.agents/skills/*
common/role-contracts/*     -> <repo>/architecture/agent-role-contracts/*
```

建议将机械检查放进项目 `.codex/hooks.json` 或 CI，而不是继续扩大 `AGENTS.md`。目录存在特殊规则时，在最近的子目录增加 `AGENTS.override.md`。

