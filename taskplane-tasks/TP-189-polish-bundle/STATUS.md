# TP-189: Accumulated polish bundle — Status

**Current Step:** Step 1: Cluster A — Defensive tests + helper hardening
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-07
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ TP-186's Order of Operations rule is now live.** Do NOT mark a step
> `Complete` until that step's code review has returned APPROVE. This task
> is Review Level 2, per-step reviews fire automatically.
>
> **Review structure:** per-step plan + code reviews (no checkpoint markers).
> Expected: ~10 review_step calls total (5 plan + 5 code).

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On topic branch (lane branch `task/henrylach-lane-2-20260506T230236`)
- [x] Working tree clean (only STATUS.md modified)
- [x] Baseline test count recorded: **3496 pass, 1 skipped, 0 fail** (post-v0.28.8 confirmed)
- [x] All Tier 3 context files read per cluster (agent-host.ts, config-schema.ts, types.ts, lane-runner.ts spawn site, agent-bridge-extension.ts review_step + isStepMarkedComplete, bin/taskplane.mjs getVersion, worktree.ts removeWorktree + helpers, existing TP-184/186/188 test files, task-worker.md, SKILL.md Review Levels rubric)
- [x] Decision: Cluster B — NEW constants module exports `DEFAULT_WORKER_USER_TOOLS` only (not `ENGINE_BRIDGE_TOOLS`); `agent-host.ts` re-exports for backward compatibility (execution.ts and worker-tools-allowlist.test.ts already import from agent-host.ts — don't break)
- [N/A] ~~Decision: Cluster D — local Node 24 smoke run before bumping ci.yml~~ — Cluster D shipped in v0.28.8 (commit `96a457f5`)

---

### Step 1: Cluster A — Defensive tests + helper hardening
**Status:** 🟨 In Progress

- [x] Item 1: `lane-runner-spawn-wiring.test.ts` (NEW) — static assertion (4 tests pass)
- [x] Item 2: `review-step-guard-runtime.test.ts` (NEW) — 4 runtime tests pass: type='code' on Complete → REFUSED + no spawn + counter unchanged; type='plan' on Complete → NOT refused; type='code' on In-Progress → NOT refused; REFUSED text matches prompt Recovery Recipe wording. Uses bare-specifier `child_process` mock for Node 22/24 portability.
- [x] Item 3: `isStepMarkedComplete` now skips ``` and ~~~ fenced code blocks; 4 new test cases (2.8–2.11) cover triple-backtick, tilde fence, regression for real-status-after-fence, and unclosed-fence cross-call isolation. All pass.
- [x] Item 4 (sage TP-188 follow-up): NEW `extensions/tests/windows-worktree-cleanup-behavioral.test.ts` with 3 behavioral decision-branch tests. Uses single `child_process` mock that dispatches on cmd (git vs cmd) and uses real on-disk temp directories (no fs mocking). All 3 pass: 4.1 win32+MAX_PATH → cmd rd fires + prune-after-rd ordering verified; 4.2 win32+non-MAX_PATH → fallback skipped, WORKTREE_REMOVE_FAILED thrown with original stderr; 4.3 non-win32+MAX_PATH text → platform guard skips fallback. (Created as a sibling file rather than adding to the existing fallback test file because the new tests need a richer cmd/git dispatcher than the existing single-fixture mock supports.)
- [x] Targeted run passes: `lane-runner-spawn-wiring` (4) + `review-step-guard-runtime` (4) + `worker-step-completion-protocol` (19, includes 4 new fence-block cases) + `windows-worktree-cleanup-behavioral` (3) = 30 tests, all green.

---

### Step 2: Cluster B — Constants module migration
**Status:** ⬜ Not Started

- [ ] `extensions/taskplane/tool-allowlist-constants.ts` (NEW) — single source of truth
- [ ] `agent-host.ts` imports from new module (re-exports per Step 0 decision)
- [ ] `config-schema.ts` and `types.ts` literals replaced with import; annotation comments removed
- [ ] No circular imports (verified via import probe)
- [ ] Full fast suite still passes (no behavior change)

---

### Step 3: Cluster C — taskplane doctor empty pi version
**Status:** ⬜ Not Started

- [ ] `getVersion()` in `bin/taskplane.mjs` captures both stdout and stderr
- [ ] Manual: `node bin/taskplane.mjs doctor` shows pi version (e.g., `0.73.x`)
- [ ] Optional: `cli-doctor-version-capture.test.ts` (skip if testability awkward)

---

### Step 4: Cluster D — CI Node 24 alignment
**Status:** ✅ Already shipped in v0.28.8 (commit `96a457f5`)

- [x] ~~Local smoke: `npm run test:fast` on Node 24 passes~~ — done during v0.28.8 release validation
- [x] ~~`ci.yml` `node-version: "22"` → `"24"`~~ — done in commit `96a457f5`
- [x] ~~PR CI passes with Node 24~~ — PR #552 + #554 both passed CI on Node 24

*This step is preserved in the structure for traceability but has no work to perform. Future executions of this task should skip it.*

---

### Step 5: Cluster E — Worker prompt + skill reconciliation
**Status:** ⬜ Not Started

> ⚠️ Hydrate: specific edits depend on Discovery-pass findings.

- [ ] Item 7 Discovery: grep `task-worker.md` for checkbox/step-transition keywords; identify potential conflicts with new Order of Operations
- [ ] Item 7: per-section decisions documented in Discoveries (rewrite/cross-reference/leave as-is)
- [ ] Item 7: edits applied
- [ ] Item 8: `SKILL.md` Review Levels rubric augmented with per-step vs. consolidated pattern documentation
- [ ] Item 8: TP-186 referenced as a real consolidation example

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passing (count = baseline + new tests from A/C)
- [ ] Integration suite passing
- [ ] CLI smoke clean; doctor shows pi version
- [ ] No circular imports (re-verified)

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entries categorized: Internal (A1-2, B, D), Fixed (A3, C), Docs (E)
- [ ] Discoveries logged (especially Cluster E per-section rationale)

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Cluster B: New module `tool-allowlist-constants.ts` exports only `DEFAULT_WORKER_USER_TOOLS`; `ENGINE_BRIDGE_TOOLS` stays in `agent-host.ts` (no duplication problem there). `agent-host.ts` re-exports `DEFAULT_WORKER_USER_TOOLS` from the new module for backward compatibility (existing imports in `execution.ts` and `worker-tools-allowlist.test.ts` continue to work). | Decision — directs Step 2 implementation | `extensions/taskplane/{tool-allowlist-constants.ts (new), agent-host.ts, config-schema.ts, types.ts}` |
| Cluster B: `config-schema.ts` is currently import-free; `types.ts` imports only from `path` and `./diagnostics.js`. Neither module pulls `child_process`/`fs`. Importing `DEFAULT_WORKER_USER_TOOLS` from a new pure-data module (no imports) is safe — no circular import risk because the new module imports nothing. | Verified safe | (verified via `head -25` + `grep -n "^import"`) |
| Baseline test count: **3496 pass / 1 skipped / 0 fail** post-v0.28.8 (PROMPT predicted 3496+; matches). | Baseline — final count should be 3496 + new tests from Clusters A and C (4-7 new). | n/a |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-07 03:02 | Task started | Runtime V2 lane-runner execution |
| 2026-05-07 03:02 | Step 0 started | Preflight |

---

## Blockers

*None — all dependencies (TP-181, TP-184, TP-185, TP-186) shipped in v0.28.5/v0.28.6.*

---

## Notes

- This task documents 8 polish items that accumulated across multiple sage code
  reviews and post-release follow-ups. Bundling them avoids the overhead of
  ~5 separate hot-fix releases for low-priority items.
- Recommended release: v0.28.7 with TP-187 + TP-188 + TP-189 (or split into
  v0.28.7 with the bug fixes and v0.28.8 with this polish).
- Per-step reviews are the deliberate choice (not consolidation) because the
  clusters are independent and Cluster E specifically documents the per-step
  default.
| 2026-05-07 03:07 | Review R001 | plan Step 1: APPROVE |
