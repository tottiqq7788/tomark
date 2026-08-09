---
name: evidence-closeout
description: Bind implementation, tests, static checks, contract checks, runtime E2E, and limitations to an immutable commit and decide whether a governance work package can close. Use after independent review or when preparing a release or governance milestone.
---

# Evidence Closeout

1. Confirm the candidate commit is immutable and the worktree is clean.
2. Validate every required evidence item against its declared type and commit.
3. Reject evidence recorded against another commit unless explicitly marked historical.
4. Distinguish passed, failed, skipped, unavailable and not-required evidence.
5. Verify no unresolved blocker, scope expansion or missing approval remains.
6. Write the closeout conclusion without rewriting historical Inventory as current truth.
7. Close only when all mandatory evidence is present; otherwise return `evidence_incomplete` with exact gaps.

Never substitute static scanning for runtime behavior or targeted tests for a required full lane.

