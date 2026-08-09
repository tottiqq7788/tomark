---
name: legacy-system-discovery
description: Perform read-only brownfield discovery of an existing repository and produce candidate inventories for modules, routes, permissions, state transitions, data writes, Agent tools, workers, tests, and deployment paths. Use before governing a legacy system; never treat discovered code behavior as approved product semantics without confirmation.
---

# Legacy System Discovery

1. Freeze the repository commit and record environment limitations.
2. Inventory modules, public entry points, state transitions, persistent writes, authorization gates, workers, Agent tools and test lanes.
3. Attach each finding to source paths and confidence: `observed`, `inferred`, or `unknown`.
4. Identify duplicate authority, bypass paths, stale code and missing runtime evidence.
5. Generate candidate L1/L2 mappings only. Ask authorized stakeholders to confirm or define L0.
6. Preserve contradictions rather than selecting a convenient interpretation.
7. Produce bounded work-package candidates; do not modify production code during discovery.

Report scanner blind spots and external integrations that could not be inspected.

