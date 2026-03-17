## Plan Review: Step 2: Testing & Verification

### Verdict: REVISE

### Summary
The Step 2 plan is still too high-level to verify the new Layer 2 behavior safely. `STATUS.md` currently lists only generic test intent plus a full-suite run, which does not demonstrate the boundary guarantees and failure handling introduced in Step 1. Add a few outcome-level test bullets covering guardrails, path resolution, and malformed-input behavior.

### Issues Found
1. **Severity: important** — The plan does not explicitly test the Layer 1 protection rule. `STATUS.md:37` says “loading, auto-creation, and merge,” but this is insufficient for the explicit constraint in `PROMPT.md:96` and the allowlist boundary in `extensions/taskplane/config-loader.ts:467-525`. **Fix:** add a test outcome proving non-allowlisted keys / non-L2 paths are ignored while allowlisted fields still override.
2. **Severity: important** — Path-resolution behavior is not represented in Step 2 outcomes even though it is a recorded discovery (`STATUS.md:64`) and core runtime behavior (`extensions/taskplane/config-loader.ts:406-412`). **Fix:** include tests for default home-based path and `PI_CODING_AGENT_DIR` override.
3. **Severity: important** — Failure and edge-case semantics introduced in Step 1 are not covered by the current checklist (`STATUS.md:37-38`), including malformed JSON fallback and empty-string no-op semantics (`extensions/taskplane/config-loader.ts:447-457`, `504-523`). **Fix:** add explicit test outcomes for malformed preferences, unknown-key dropping, empty-string “not set,” and `dashboardPort` remaining preferences-only.

### Missing Items
- Test-isolation intent to avoid writing to real user home during tests (set/reset `PI_CODING_AGENT_DIR` to temp dirs).
- Integration coverage intent for both Layer 1 sources: JSON-backed and YAML-backed configs, then Layer 2 merge on top (`loadProjectConfig`, `extensions/taskplane/config-loader.ts:589-614`).
- Planned test location aligned with existing loader test patterns (likely `extensions/tests/project-config-loader.test.ts`).

### Suggestions
- Keep full-suite `cd extensions && npx vitest run`, but also note a targeted test command for fast iteration while developing Step 2.
