# TP-189: Accumulated polish bundle — Status

**Current Step:** Step 7: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-05-07 (task complete)
**Review Level:** 2
**Review Counter:** 12
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
**Status:** ✅ Complete (code review APPROVE R004)

- [x] Item 1: `lane-runner-spawn-wiring.test.ts` (NEW) — static assertion (4 tests pass)
- [x] Item 2: `review-step-guard-runtime.test.ts` (NEW) — 4 runtime tests pass: type='code' on Complete → REFUSED + no spawn + counter unchanged; type='plan' on Complete → NOT refused; type='code' on In-Progress → NOT refused; REFUSED text matches prompt Recovery Recipe wording. Uses bare-specifier `child_process` mock for Node 22/24 portability.
- [x] Item 3: `isStepMarkedComplete` now skips ``` and ~~~ fenced code blocks; 4 new test cases (2.8–2.11) cover triple-backtick, tilde fence, regression for real-status-after-fence, and unclosed-fence cross-call isolation. All pass.
- [x] Item 4 (sage TP-188 follow-up): NEW `extensions/tests/windows-worktree-cleanup-behavioral.test.ts` with 3 behavioral decision-branch tests. Uses single `child_process` mock that dispatches on cmd (git vs cmd) and uses real on-disk temp directories (no fs mocking). All 3 pass: 4.1 win32+MAX_PATH → cmd rd fires + prune-after-rd ordering verified; 4.2 win32+non-MAX_PATH → fallback skipped, WORKTREE_REMOVE_FAILED thrown with original stderr; 4.3 non-win32+MAX_PATH text → platform guard skips fallback. (Created as a sibling file rather than adding to the existing fallback test file because the new tests need a richer cmd/git dispatcher than the existing single-fixture mock supports.)
- [x] Targeted run passes: `lane-runner-spawn-wiring` (4) + `review-step-guard-runtime` (4) + `worker-step-completion-protocol` (19, includes 4 new fence-block cases) + `windows-worktree-cleanup-behavioral` (3) = 30 tests, all green.
- [x] **R002 fix 1 (important):** `isStepMarkedComplete` now tracks fence opener char + length (CommonMark semantics) — only closes on a matching delimiter (same char, length ≥ opener length). Step-heading detection is also gated on being outside a fence.
- [x] **R002 fix 2 (important):** added `type='test'` REFUSED runtime test (5th test in the file) — verifies REFUSED token, no spawn, counter unchanged, and that the refusal message echoes `type="test"` in the re-call instruction.
- [x] **R002 test gap:** added 2 new regression cases (2.12, 2.13) to `worker-step-completion-protocol.test.ts` — mixed-delimiter (4-backtick fence containing `~~~` and ``` examples + literal Status line, expects false) and equal-length closer (CommonMark length≥opener semantics).

---

### Step 2: Cluster B — Constants module migration
**Status:** ✅ Complete (code review APPROVE R006)

- [x] `extensions/taskplane/tool-allowlist-constants.ts` (NEW, 38 lines) — single source of truth, no imports beyond TS built-ins (verified)
- [x] `agent-host.ts` re-exports `DEFAULT_WORKER_USER_TOOLS` from the new module via `export { ... } from` plus a local `import` for in-file usage; existing internal callers (`execution.ts`, `worker-tools-allowlist.test.ts`) continue to work unchanged
- [x] `config-schema.ts` (worker.tools default + merge.tools default) and `types.ts` (merge.tools default) now reference `DEFAULT_WORKER_USER_TOOLS` via direct import; obsolete TP-184 NOTE comments replaced with TP-189 (Cluster B) comments explaining the new sourcing
- [x] No circular imports: `node -e "await import('./taskplane/types.ts'); await import('./taskplane/config-schema.ts'); await import('./taskplane/agent-host.ts'); await import('./taskplane/tool-allowlist-constants.ts')"` succeeds
- [x] `worker-tools-allowlist.test.ts` (16 tests) still passes — the constant value is unchanged, only its source module moved

---

### Step 3: Cluster C — taskplane doctor empty pi version
**Status:** ✅ Complete (code review APPROVE R009)

- [x] `getVersion()` extracted to NEW `bin/get-version.mjs` (testable ESM helper) and imported from `bin/taskplane.mjs`. Uses `spawnSync` with `stdio:['ignore','pipe','pipe']`, stdout-precedence with stderr fallback, AND **R008 fix**: gates on `result.error || result.status !== 0` so non-zero exits return null instead of leaking shell error text as a fake version string (preserves the prior execSync-throws-on-failure contract).
- [x] Manual: `node bin/taskplane.mjs doctor` now shows `✅ pi installed (0.73.0)` (was empty parens).
- [x] `cli-doctor-version-capture.test.ts` (NEW, 7 BEHAVIORAL tests): exercises the helper with real `node -e ...` subprocesses. Covers stdout success, stderr fallback (the pi case), stdout-over-stderr precedence, trimming, non-zero-exit returns null (R008 regression), nonexistent command returns null, both-empty-on-success returns null.

---

### Step 4: Cluster D — CI Node 24 alignment
**Status:** ✅ Already shipped in v0.28.8 (commit `96a457f5`)

- [x] ~~Local smoke: `npm run test:fast` on Node 24 passes~~ — done during v0.28.8 release validation
- [x] ~~`ci.yml` `node-version: "22"` → `"24"`~~ — done in commit `96a457f5`
- [x] ~~PR CI passes with Node 24~~ — PR #552 + #554 both passed CI on Node 24

*This step is preserved in the structure for traceability but has no work to perform. Future executions of this task should skip it.*

---

### Step 5: Cluster E — Worker prompt + skill reconciliation
**Status:** ✅ Complete (code review APPROVE R012)

> ⚠️ Hydrate: specific edits depend on Discovery-pass findings.

- [x] Item 7 Discovery: grepped `task-worker.md`. Two real conflicts identified (other matches are consistent with the new rule):
  1. **Resume Algorithm step 6** — "all items checked → next step" doesn't account for Level ≥ 2's APPROVE-gating.
  2. **Checkpoint Discipline / Git commits** — example commit `"complete Step N — description"` conflicts with the Order of Operations example commit `"step N implementation"`.
  All other matches (Resume Algorithm step 7 "top-of-file Status", Scope Rules "complete each step", Error Handling general checkbox advice) are consistent and need no change.
- [x] Item 7: per-section decisions documented in Discoveries.
- [x] Item 7: 2 surgical edits applied to `templates/agents/task-worker.md`:
  1. Resume Algorithm step 6 split into Level 0/1 (proceed) vs Level 2/3 (commit + code review + APPROVE-gated status flip), with explicit cross-reference to **Order of Operations**.
  2. Checkpoint Discipline / Git commits — example commit message rewritten to `"step N implementation"`; new paragraphs distinguish Level 0/1 (commit completes the step) from Level 2/3 (commit is impl-only, separate post-APPROVE `"step N complete (code review APPROVE)"` commit).
  Existing `worker-step-completion-protocol.test.ts` (23 substring assertions) still passes — the new paragraphs reuse the canonical wording from the Order of Operations + Recovery Recipe sections.
- [x] Item 8: `SKILL.md` Complexity Assessment augmented with new sub-section **"Per-Step Reviews vs. Consolidated Reviews (Checkpoint Markers)"**. Documents: default per-step behavior (e.g., 5-impl-step Level 2 task → ~10 reviews), opt-in consolidation via `**Plan-review checkpoint**` / `**Code review checkpoint**` markers, when-to-use-which guidance, and a PROMPT-authoring decision heuristic.
- [x] Item 8: TP-186 referenced as the canonical consolidation example (1 design + 3 mechanical impl + 1 verify → 2 reviews total instead of ~8).

---

### Step 6: Testing & Verification
**Status:** ✅ Complete (verification-only step — no code review per the rubric "skip reviews for the final documentation step"; this is the testing gate immediately preceding it)

> ZERO test failures allowed.

- [x] FULL fast suite passing: **3524 pass / 1 skipped / 0 fail** (baseline 3496 + 28 new tests from Clusters A and C). Worktree Lifecycle Harness: 69/69 pass.
- [x] Integration suite passing: combined `tests/*.test.ts tests/*.integration.test.ts` run — 3524 pass / 1 skipped / 0 fail (the `*.test.ts` glob already includes `.integration.test.ts` files).
- [x] CLI smoke clean: `taskplane help` shows the v0.28.8 banner; `taskplane doctor` now shows `✅ pi installed (0.73.0)` (Cluster C verified end-to-end on a real machine).
- [x] No circular imports: import probe (`types.ts`, `config-schema.ts`, `agent-host.ts`, `tool-allowlist-constants.ts`) succeeds.
- [N/A] ~~Verify Cluster D CI change works on the PR's CI run~~ — Cluster D was already shipped in v0.28.8 (PR #552 + #554).

---

### Step 7: Documentation & Delivery
**Status:** ✅ Complete

- [x] CHANGELOG entries added under [Unreleased], categorized:
  - **Fixed** (user-visible): TP-189-C `taskplane doctor` empty pi version; TP-189-A3 `isStepMarkedComplete` fenced-code-block filter
  - **Docs** (user-visible): TP-189-E task-worker.md reconciliation; SKILL.md per-step vs. consolidated review pattern
  - **Internal** (refactors / regression tests): TP-189-B constants module migration; TP-189-A1 spawn-site regression guard; TP-189-A2 REFUSED-path runtime test; TP-189-A4 removeWorktree behavioral tests
  - Cluster D was already shipped in v0.28.8 — no entry needed.
- [x] Discoveries logged in STATUS.md (Cluster B decision rationale + Cluster E per-section conflict analysis).

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
| Cluster E Discovery: only 2 sections in `task-worker.md` create mental dissonance with the TP-186 Order of Operations rule. (1) Resume Algorithm step 6 ("all items checked → proceed to next step") doesn't cross-reference the review-gated completion requirement for Level ≥ 2. (2) The example commit message in Checkpoint Discipline says `complete Step N — description` which conflicts with the Order of Operations example commit message (`step N implementation`). | Two surgical edits planned (cross-reference + rewrite). | `templates/agents/task-worker.md` lines 36, 128–132 |

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
| 2026-05-07 03:17 | Review R002 | code Step 1: REVISE |
| 2026-05-07 03:21 | Review R003 | code Step 1: REVISE |
| 2026-05-07 03:24 | Review R004 | code Step 1: APPROVE |
| 2026-05-07 03:25 | Review R005 | plan Step 2: APPROVE |
| 2026-05-07 03:28 | Review R006 | code Step 2: APPROVE |
| 2026-05-07 03:29 | Review R007 | plan Step 3: APPROVE |
| 2026-05-07 03:32 | Review R008 | code Step 3: REVISE |
| 2026-05-07 03:34 | Review R009 | code Step 3: APPROVE |
| 2026-05-07 03:36 | Review R010 | plan Step 5: APPROVE |
| 2026-05-07 03:40 | Review R011 | code Step 5: REVISE |
| 2026-05-07 03:42 | Review R012 | code Step 5: APPROVE |
