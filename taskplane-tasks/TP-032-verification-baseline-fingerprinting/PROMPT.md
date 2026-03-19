# Task: TP-032 — Verification Baseline & Fingerprinting

**Created:** 2026-03-19
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** New verification subsystem. Parses test framework output. Affects merge-gate decisions. Must handle flaky tests and missing baselines.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-032-verification-baseline-fingerprinting/
├── PROMPT.md ├── STATUS.md ├── .reviews/ └── .DONE
```

## Mission

Implement verification baseline capture before wave merges and post-merge
comparison. Parse test output into normalized fingerprints so pre-existing
failures don't block valid merges. Support flaky test detection (re-run once),
strict/permissive modes, and per-repo baselines in workspace mode.

## Dependencies

- **Task:** TP-030 (v3 state schema for storing verification results)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 4 section 4a
- `extensions/taskplane/merge.ts` — Current merge flow
- `extensions/taskplane/engine.ts` — Wave lifecycle
- `extensions/taskplane/config-schema.ts` — Configuration structure

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/verification.ts` (new)
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/tests/verification-baseline.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read current merge flow and verification command execution
- [ ] Read roadmap Phase 4 section 4a
- [ ] Understand vitest output format for fingerprinting

### Step 1: Verification Command Runner & Fingerprint Parser

- [ ] Create `extensions/taskplane/verification.ts`
- [ ] Implement `runVerificationCommands()` that executes configured testing commands
- [ ] Implement `parseTestOutput()` with adapters for vitest JSON output (extensible for jest/pytest later)
- [ ] Produce normalized fingerprints: `{ commandId, file, case, kind, messageNorm }`
- [ ] Implement `diffFingerprints(baseline, postMerge)` returning new failures only

**Artifacts:**
- `extensions/taskplane/verification.ts` (new)

### Step 2: Baseline Capture & Comparison in Merge Flow

- [ ] Before wave merge, capture baseline per repo: run verification in merge worktree pre-merge state
- [ ] Store baseline: `.pi/verification/{opId}/baseline-b{batchId}-repo-{repoId}-wave-{n}.json`
- [ ] After merge, capture post-merge fingerprints
- [ ] Compute `newFailures = postMerge - baseline`
- [ ] If no new failures: merge passes verification
- [ ] If new failures: classify `verification_new_failure`, block merge
- [ ] Implement flaky handling: re-run failed commands once; if failure disappears → `flaky_suspected` warning

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)
- `extensions/taskplane/engine.ts` (modified)

### Step 3: Configuration & Modes

- [ ] Add `verification` config section: `enabled` (default false), `mode` (strict/permissive), `flaky_reruns` (default 1)
- [ ] Strict mode: pause with diagnostic if baseline unavailable
- [ ] Permissive mode: continue with current verification behavior if baseline unavailable
- [ ] Feature flag: entire verification system disabled by default (opt-in)

**Artifacts:**
- `extensions/taskplane/config-schema.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: fingerprint parser extracts correct fields from vitest output
- [ ] Test: diffFingerprints identifies only new failures
- [ ] Test: pre-existing failures don't block merge
- [ ] Test: new failures block merge
- [ ] Test: flaky test re-run clears false positive
- [ ] Test: strict mode pauses on missing baseline
- [ ] Test: permissive mode continues on missing baseline
- [ ] Test: per-repo baselines in workspace mode
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Document verification config in `docs/reference/configuration/task-orchestrator.yaml.md`
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/task-orchestrator.yaml.md` — verification config section

**Check If Affected:**
- `docs/reference/commands.md` — if verification affects merge output

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Pre-existing failures no longer block merges (when enabled)
- [ ] New failures correctly detected and block merge
- [ ] Works in repo mode and workspace mode
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-032): complete Step N — description`
- **Bug fixes:** `fix(TP-032): description`
- **Tests:** `test(TP-032): description`
- **Hydration:** `hydrate: TP-032 expand Step N checkboxes`

## Do NOT

- Enable verification by default (opt-in feature)
- Block merges when verification is disabled
- Hardcode test framework parsers — keep adapter pattern extensible

---

## Amendments (Added During Execution)
