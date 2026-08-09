---
name: architecture-review
description: Independently review a change against its declared L0/L1/L2 impact, architecture contracts, task envelope, and evidence requirements. Use after implementation, during pull-request review, or when architecture drift or an unmapped code path is suspected.
---

# Architecture Review

1. Reconstruct the diff from the declared immutable baseline.
2. Compare changed files, imports, routes, tables, events and workers with declared L2 scope.
3. Trace changes upward to L1 responsibility and L0 semantics.
4. Search for related entry points that bypass the intended boundary.
5. Verify positive behavior, forbidden outcomes, denial-before-side-effect and required fault injection.
6. Separate static, contract, unit/integration and runtime E2E conclusions.
7. Return one of: `accepted`, `correction_required`, `scope_reopened`, or `evidence_incomplete`.

Do not accept the implementation owner's narrative as evidence without reproducing the relevant checks.

