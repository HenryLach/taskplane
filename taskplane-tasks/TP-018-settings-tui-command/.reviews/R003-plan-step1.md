## Plan Review: Step 1: Design Settings Navigation

### Verdict: REVISE

### Summary
The preflight notes are detailed, but the Step 1 plan is not yet safe to execute as-is. There is a concrete Layer-ownership misclassification that would lead to incorrect write-target behavior, and the plan still lacks key design outcomes needed to render correct source indicators and schema discoverability. Tightening these now will prevent rework in Steps 2–3.

### Issues Found
1. **[Severity: important]** — `taskRunner.worker.spawnMode` is currently marked as `L1+L2` in the plan artifact (`taskplane-tasks/TP-018-settings-tui-command/STATUS.md:166,189,245`), but Layer 2 allowlist does **not** include it (`extensions/taskplane/config-schema.ts:348-358`, `extensions/taskplane/config-loader.ts:495-519`). This field should be treated as Layer 1 only (with optional/inherit semantics), otherwise `/settings` may attempt invalid preference writes.
2. **[Severity: important]** — The Step 1 checklist is too thin to guarantee correct source indicators (`STATUS.md:33-34`) given current loader behavior. `loadProjectConfig()` applies preferences in-place (`extensions/taskplane/config-loader.ts:589-614`), which loses provenance unless Step 1 explicitly designs a per-field source model. Add a Step 1 outcome that defines how each displayed value is tagged as project/user/default.
3. **[Severity: important]** — Current design notes classify many schema fields as “edit JSON directly” (`STATUS.md:275-289`), but the task requires complete schema discoverability (`PROMPT.md:25-26,106`). Step 1 should define how non-editable fields are still surfaced (e.g., read-only rows or “advanced/JSON-only” entries), not silently omitted.

### Missing Items
- Explicit navigation tree (section order + subsection structure) and disambiguation for duplicate labels like `spawnMode` in multiple locations.
- Clear unset/clear semantics for optional fields and empty-string preferences (`extensions/taskplane/config-loader.ts:491-493`).
- Step 1 test-intent notes for source badge correctness and write-target routing for mixed-layer fields.

### Suggestions
- Add a compact “field contract table” for Step 1 with: config path, editable?, control type, source badge rule, and write target.
- Include one example per source state (project-set, user-override, default-only) to anchor Step 2 implementation.
