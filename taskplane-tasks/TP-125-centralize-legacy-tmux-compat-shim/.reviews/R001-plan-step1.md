## Plan Review: Step 1: Introduce compatibility shim module

### Verdict: APPROVE

### Summary
The Step 1 plan is aligned with the PROMPT requirements and is scoped to the correct outcome: introducing a single compatibility shim before replacing call sites. It covers the three required behavior areas (config alias normalization, persisted lane alias normalization, and spawnMode legacy classification/deprecation) and fits the staged migration strategy established in Step 0. I don’t see any blocking gaps that would prevent successful implementation of this step.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for Step 1 planning.

### Missing Items
- None.

### Suggestions
- Define helper contracts in `tmux-compat.ts` to support both normalization and non-mutating classification use cases, since later callers include both data loaders and warning-only preflight/runtime messaging paths.
- Keep helper naming explicit about directionality (legacy → canonical) to reduce misuse when the same module is reused in Step 2 and future cleanup tasks.
