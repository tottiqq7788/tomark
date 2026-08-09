---
name: governance-onboarding
description: Initialize the project governance control plane for a new or existing repository. Use when adopting governance, creating the architecture directory, selecting greenfield versus brownfield discovery, or establishing the first governed baseline. Do not use to infer approved business semantics from source code alone.
---

# Governance Onboarding

1. Determine whether the repository is `new` or `existing`.
2. Run the package bootstrap script or create the equivalent governance scaffold.
3. Record the immutable baseline commit. If none exists, label the baseline `unversioned` and require Git initialization before closeout.
4. For a new project, collect source requirements and create candidate L0 rules before implementation.
5. For an existing project, invoke `$legacy-system-discovery`; keep scan results as candidates until confirmed.
6. Validate all JSON against the bundled schemas and run the project audit.
7. Report what is authoritative, candidate, missing, and explicitly out of scope.

Never claim onboarding is complete merely because directories exist.

