---
name: architecture-admission
description: Perform architecture admission before implementing a feature, defect fix, refactor, permission change, lifecycle change, data-boundary change, or Agent/runtime change. Use to classify L0 impact, map L1 responsibilities and L2 components, define invariants and forbidden outcomes, and issue a governed task envelope.
---

# Architecture Admission

1. Read `architecture/governance.json` and resolve the active semantic map, contracts and baseline.
2. Classify the task as `none`, `modify_existing`, or `add_new` L0 impact.
3. Identify affected stages, actors, business objects, state transitions and data authority.
4. State:
   - invariants that must remain true;
   - outcomes that must be rejected;
   - L1 owners and reviewers;
   - L2 code, routes, tables, workers and tests;
   - static, contract, test and runtime evidence required.
5. Check for conflicts with existing rules and unresolved candidate definitions.
6. Create or update one work package and one task envelope.
7. Stop before implementation if approval, baseline, authority or required semantics are missing.

Do not reduce an L0 change to a local code fix because the requested UI or endpoint appears small.

