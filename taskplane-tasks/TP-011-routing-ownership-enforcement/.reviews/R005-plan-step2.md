# R005 — Plan Review (Step 2: Cover governance scenarios)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-011-routing-ownership-enforcement/PROMPT.md`
- `taskplane-tasks/TP-011-routing-ownership-enforcement/STATUS.md`
- `extensions/tests/discovery-routing.test.ts`
- `extensions/tests/workspace-config.test.ts`
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/discovery.ts`

## Blocking findings

### 1) Step 2 is not hydrated into implementation-level work
`STATUS.md` Step 2 still has only prompt-level bullets (`STATUS.md:47-51`).

For this task, Step 2 needs concrete checklist items (target files + exact scenarios + verification commands), not just outcome statements.

### 2) Plan does not define Step 2 delta vs already-covered scenarios
Most Step 2 acceptance intent is already present in existing tests:
- strict behavior: `19.x`, `20.x`, `24.1`, `24.2`
- permissive behavior: `21.x`, `24.3`
- repo-mode non-regression: `18.3`, `23.1`

Without explicitly declaring whether Step 2 is **verification-only** or **incremental coverage**, the plan is ambiguous and likely to produce redundant edits.

### 3) Governance edge case still missing from the plan (`routing.strict: null` fail-open)
Current parsing still accepts explicit `null` and silently falls back to permissive mode:
- `extensions/taskplane/workspace.ts:321-330`
  - guard allows `null`
  - `const strict = rawStrict === true`

This contradicts Step 1’s “close fail-open gap” claim in `STATUS.md` and is directly relevant to Step 2 governance coverage.

## Required plan updates before implementation
1. Hydrate Step 2 in `STATUS.md` into concrete sub-tasks (file-level and scenario-level).
2. Explicitly declare Step 2 scope:
   - **verification-only** (map existing tests), or
   - **incremental** (only add missing coverage).
3. Add a compact coverage matrix mapping each Step 2 acceptance bullet to exact test IDs (existing + new).
4. Add explicit governance coverage for invalid-but-present strict values (`null` and empty YAML value), including expected failure mode (`WORKSPACE_SCHEMA_INVALID`).
5. Add at least one behavior-level repo-mode assertion through `runDiscovery()` showing strict-routing policy is not applied when `workspaceConfig` is absent.

## Non-blocking note
Test numbering is currently duplicated in a few sections; for Step 2 additions, prefer a clean new section range (or a focused governance test file) to keep future reviews straightforward.
