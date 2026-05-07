# TP-189: Accumulated polish bundle — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-06
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
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
**Status:** ⬜ Not Started

- [ ] On topic branch (e.g., `chore/tp-189-polish-bundle`)
- [ ] Working tree clean
- [ ] Baseline test count recorded (post-v0.28.8: should be 3496+)
- [ ] All Tier 3 context files read per cluster
- [ ] Decision: Cluster B re-export strategy — direct import only, or also re-export from `agent-host.ts`
- [N/A] ~~Decision: Cluster D — local Node 24 smoke run before bumping ci.yml~~ — Cluster D shipped in v0.28.8 (commit `96a457f5`)

---

### Step 1: Cluster A — Defensive tests + helper hardening
**Status:** ⬜ Not Started

- [ ] Item 1: `lane-runner-spawn-wiring.test.ts` (NEW) — static assertion
- [ ] Item 2: `review-step-guard-runtime.test.ts` (NEW) — runtime test of REFUSED path (3 sub-cases: code blocked, test blocked, plan NOT blocked)
- [ ] Item 3: `isStepMarkedComplete` ignores fenced code blocks; matching test added
- [ ] Item 4 (sage TP-188 follow-up): behavioral tests for `removeWorktree()` Windows fallback in `windows-worktree-cleanup-fallback.test.ts` (3 sub-cases: MAX_PATH on win32 → fallback fires; non-MAX_PATH on win32 → fallback skipped; non-win32 + MAX_PATH text → fallback skipped)
- [ ] Targeted run passes for all four new/modified tests

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

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |

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
