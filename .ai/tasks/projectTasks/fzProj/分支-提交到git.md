# 分支-提交到 git

仅在当前独立分支 worktree 中完成本地 Git 提交，并展示该分支最近 5 次提交。

## 目标

1. 确认当前 Cursor 窗口、分支目录与 Git worktree 相互对应。
2. 只提交当前分支工作目录中的变更，沿用项目「提交到 git」的版本号与备注规则。
3. 提交后展示当前分支状态与最近 5 次提交。

## 分支环境校验（必须先执行）

1. 检查：
   - `git rev-parse --is-inside-work-tree`
   - `git rev-parse --show-toplevel`
   - `git branch --show-current`
   - `git status -sb`
   - `git worktree list --porcelain`
2. 确认：
   - 当前 Cursor 工作区根目录就是当前 Git 根目录。
   - 当前目录是位于同级 `<项目名>-fz/<分支目录>/` 下的独立 linked worktree。
   - 当前分支不是 detached HEAD，且与 worktree 记录一致。
3. 任一条件不满足时停止，提示用户先执行 `.ai/tasks/projectTasks/创建分支.md`，或用独立 Cursor 窗口打开正确分支目录；不得在主项目工作区代替提交。

## 版本与提交说明

1. 执行时先读取 `.ai/tasks/projectTasks/提交到git.md`，沿用其中当前有效的版本号递增规则、安全要求与提交说明格式。
2. 根据**当前分支本次 diff**判定功能体量并计算版本；不要读取或修改其它 worktree 的未提交内容。
3. 提交说明须写清本分支提交了什么，并在版本号后带上当前分支名，推荐格式：
   ```text
   vX.Y.Z [<分支名>] <本次提交内容>
   ```
4. 用户已提供备注时保留其含义；未提供则根据 diff 自动起草，不向用户反复确认。

## 执行步骤

1. 完成「分支环境校验」，记录当前分支名与 worktree 绝对路径。
2. 并行查看当前 worktree 的：
   - `git status`
   - `git diff`
   - `git diff --cached`
   - `git log -5 --oneline`
3. 检查全部待提交文件：
   - 只纳入当前 worktree 内与本次分支开发相关的变更。
   - 默认排除 `.env`、凭证、私钥、token 等疑似敏感文件，并在结果中说明。
   - 不得通过绝对路径或 `git -C` 暂存原项目、其它 worktree 的文件。
4. 按普通「提交到 git」任务的规则计算版本并自动起草备注。
5. 暂存相关文件并直接提交，使用 HEREDOC 传递提交说明，例如：
   ```bash
   git add <当前分支相关文件>
   git commit -m "$(cat <<'EOF'
   vX.Y.Z [<分支名>] <写清提交了什么>

   EOF
   )"
   ```
6. 不跳过 hooks。若 hooks 失败，修复明确问题后重新创建提交；不要使用 `--no-verify`。
7. 提交完成后执行：
   - `git status -sb`
   - `git log -5 --oneline`
   - `git show --stat --oneline HEAD`
8. 回复当前分支、worktree 路径、commit hash、版本号、提交内容、工作区状态与最近 5 次提交。

## 产出

- 当前独立分支上的一次本地 commit（无变更时不创建空提交）。
- 当前分支最近 5 次提交与提交后状态。

## 约束

- 仅提交当前分支 worktree；禁止切换到主项目或其它 worktree 代替执行。
- 不自动 merge、rebase、push、打 tag 或修改 `git config`。
- 不使用 force、hard reset、`--no-verify` 等破坏性/绕过检查操作。
- 没有可提交变更时只说明现状，不创建空提交，也不递增版本。
- 需求清晰时直接提交，不询问备注、版本号或是否提交。

## 参考

- 创建独立分支：`.ai/tasks/projectTasks/创建分支.md`
- 普通提交规则：`.ai/tasks/projectTasks/提交到git.md`
- 分支开发任务：`.ai/tasks/devTasks/fzDev/`
