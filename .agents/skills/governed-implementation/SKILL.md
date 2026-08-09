---
name: governed-implementation
description: Implement an approved governance work package within a frozen baseline and explicit task envelope. Use when architecture admission is complete and the implementation owner must change code, tests, migrations, or configuration without expanding product semantics.
---

# Governed Implementation

1. Verify role, baseline commit, worktree cleanliness and allowed scope from the task envelope.
2. Read only the referenced rules, contracts, inventory entries and evidence requirements.
3. Implement the smallest coherent change that preserves every invariant and rejects every forbidden outcome.
4. Add positive, negative and fault-injection tests required by the contract.
5. Before expanding scope, stop and return to `$architecture-admission`.
6. Run targeted verification first, then the required governed lanes.
7. Commit independent logical units and report exact commands, counts, failures and skipped evidence.

Never change L0 definitions, evidence requirements or closeout criteria merely to make implementation pass.

