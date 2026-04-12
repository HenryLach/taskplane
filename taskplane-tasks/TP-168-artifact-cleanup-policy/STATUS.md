# TP-168: Artifact Cleanup Policy — Status

**Current Step:** Step 1: Expand Age Sweep Scope
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read cleanup.ts — current cleanup functions and coverage
- [x] Read extension.ts — where cleanup is called
- [x] Identify all artifact types and gaps
- [x] Document findings

**Findings:**
- cleanup.ts has 3 layers: (1) post-integrate batch-scoped, (2) age-based preflight sweep, (3) size-capped log rotation
- Age sweep (Layer 2) currently: 7 days, only covers telemetry/*.jsonl, *-exit.json, lane-prompt-*.txt, merge-result-*, merge-request-*, mailbox batch dirs, context-snapshot dirs
- GAPS: Does NOT sweep `.pi/verification/` files, `.pi/worker-conversation-*.jsonl`, `.pi/lane-state-*.json`
- No telemetry directory size cap exists
- No batch-start cleanup of prior batch artifacts
- `runPreflightCleanup` is defined in cleanup.ts but only imported (unused) in engine.ts; engine.ts calls sweepStaleArtifacts + rotateSupervisorLogs separately
- extension.ts imports sweepStaleArtifacts/rotateSupervisorLogs but never calls them (unused imports)
- engine.ts lines 2012-2043 is the actual preflight cleanup site (in engine `startBatch`)
- Post-integrate cleanup called from extension.ts:1412 (supervisor auto-integrate) and extension.ts:3330 (manual /orch-integrate)
- `formatPreflightCleanup` hardcodes ">7 days old" text that needs updating when threshold changes
- `formatPreflightSweep` also hardcodes ">7 days old"
- No existing cleanup unit tests (cleanup-resilience.test.ts tests worktree/branch cleanup, not artifact cleanup)

---

### Step 1: Expand Age Sweep Scope
**Status:** ✅ Complete

- [x] Reduce telemetry age to 3 days
- [x] Add verification/ to sweep
- [x] Add worker-conversation-*.jsonl to sweep
- [x] Add lane-state-*.json to sweep
- [x] Run targeted tests
- [ ] R002: Fix verification cleanup to sweep per-op subdirectories (not top-level files)

---

### Step 2: Add Size Cap and Batch-Start Cleanup
**Status:** ⬜ Not Started

- [ ] Implement telemetry size cap (500MB, oldest-first eviction)
- [ ] Wire into preflight cleanup
- [ ] Add batch-start cleanup for prior batch artifacts
- [ ] Run targeted tests

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Tests for expanded age sweep
- [ ] Tests for size cap eviction
- [ ] Tests for batch-start cleanup
- [ ] All failures fixed

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Docs reviewed
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-12 00:43 | Task started | Runtime V2 lane-runner execution |
| 2026-04-12 00:43 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

GitHub issue: #296
| 2026-04-12 00:46 | Review R001 | plan Step 1: APPROVE |
| 2026-04-12 00:49 | Review R002 | code Step 1: REVISE |
