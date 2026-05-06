# TP-186: Fix worker death-spiral via explicit step-completion protocol — Status

**Current Step:** Step 6: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-05-06
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ This task IS the death-spiral fix.** Per its own future-state ordering
> rule, do NOT mark any step `Complete` until that step's code review (if at
> Review Level ≥ 2) has returned APPROVE. While running this task, the worker
> is still vulnerable to the bug being fixed — proceed carefully.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main` (lane worktree)
- [x] Baseline test count recorded (post-v0.28.5: should be 3452+)
- [x] All Tier 3 context files read
- [x] Issues #537, #542, #510 read in full (context summarized in PROMPT.md Mission section; bug pattern + fix options A/B understood)
- [x] Decision recorded in Discoveries: Option A only OR Option A + Option B (default: A + B)

---

### Step 1: Plan the prompt edits and decide on Option B scope
**Status:** ✅ Complete (plan review APPROVE)

> ⚠️ Plan-review checkpoint. Reviewer evaluates wording before implementation.

- [x] Order of Operations section drafted (5–6 step numbered sequence) — see PLAN-DRAFT.md §A
- [x] Recovery Recipe drafted (revert + commit + handle REVISE through normal recipe) — PLAN-DRAFT.md §B
- [x] Forbidden callout drafted (matches existing "Workers MUST NOT" rule style) — PLAN-DRAFT.md §C
- [x] (If Option B) Guard inspection logic + refusal message designed; consistent with Recovery Recipe wording — PLAN-DRAFT.md §D
- [x] Drafts written into STATUS or scratch file for plan review — PLAN-DRAFT.md created

---

### Step 2: Apply prompt edits to templates/agents/task-worker.md
**Status:** ✅ Complete (gated by Step 5 code review APPROVE — R002)

- [x] Order of Operations section inserted (templates/agents/task-worker.md after "Correct sequence" / "WRONG sequence" blocks)
- [x] Recovery Recipe section inserted (immediately after Order of Operations)
- [x] Forbidden callout inserted (replaces former "WRONG sequence" block; old item preserved as bullet 2)
- [x] No internal contradictions with existing prompt content (top-of-file `**Status:**` is task-level; new rule governs step-level `**Status:**` headings; verified via grep)

---

### Step 3: (Optional) Implement Option B engine-side guard
**Status:** ✅ Complete (gated by Step 5 code review APPROVE — R002)

- [x] STATUS.md inspection helper added (`isStepMarkedComplete` exported from agent-bridge-extension.ts)
- [x] Wired into `review_step` handler in agent-bridge-extension.ts (early-return REFUSED before reviewer spawn)
- [x] Applied to `code` and `test` types only (NOT `plan`) — `if (reviewType !== "plan" && isStepMarkedComplete(...))`
- [x] Refusal message matches Recovery Recipe verbatim (3-step recipe with `chore(<TASK-ID>): revert premature step-N completion` commit message)

---

### Step 4: Add tests
**Status:** ✅ Complete (gated by Step 5 code review APPROVE — R002)

- [x] `worker-step-completion-protocol.test.ts` created
- [x] Source-pattern tests for the 3 prompt additions (1.1, 1.2, 1.3, 1.4)
- [x] (If Option B) Behavioral tests for the guard (2.1–2.7) + wording-consistency tests (3.1–3.3)
- [x] Targeted run passes — 14/14 pass

---

### Step 5: Testing & Verification
**Status:** ✅ Complete (R002 APPROVE)

> ZERO test failures allowed.

- [x] FULL fast suite passing (count = baseline + new tests) — 3466 pass / 0 fail / 1 skip (3452 baseline + 14 new = 3466 ✅)
- [x] Integration suite passing — `tests/*.test.ts` glob already covers `*.integration.test.ts` files; included in the 3466 above
- [x] CLI smoke clean — `taskplane help` shows full command surface; `taskplane doctor` runs successfully (exits non-zero only because the worktree is not an init'd project, which is expected and unrelated to this fix)
- [x] Code-review checkpoint: call `review_step(step=5, type='code', baseline=<sha>)` — R002 APPROVE
- [x] Per the new rule: do NOT mark Step 2 Complete until code review APPROVE — honored; Steps 2/3/4 marked Complete only after R002 APPROVE returned

---

### Step 6: Documentation & Delivery
**Status:** ✅ Complete

- [x] CHANGELOG.md Unreleased / Fixed entry added (#537, #542) — supersedes #510 noted in entry body
- [x] Comment on issue #510 noting supersession (don't close) — worker cannot post to GitHub from inside a lane; supervisor handover note logged below for integration time
- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | 1 | APPROVE | .reviews/R001-plan-step1.md |
| R002 | code | 5 | APPROVE | .reviews/R002-code-step5.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| **Decision: Option A + Option B** — implement both the prompt edits (Order of Operations + Recovery Recipe + Forbidden callout) AND the engine-side guard in `review_step` that refuses to run on already-complete steps. Rationale: prompt-only fix relies on worker reading & obeying it under context pressure (the exact failure mode #537 documents); engine-side guard provides a hard backstop with a refusal message that points to the recovery recipe, ensuring failure is loud + recoverable rather than silent + fatal. | Implementing both | Step 0 decision |
| Baseline test count: **3452 passing, 1 skipped, 3453 total** (matches PROMPT expectation of 3452+) | Recorded | `npm run test:fast` |
| **Supervisor handover — issue #510 supersession comment:** Worker cannot post comments on GitHub issues from inside a lane (no `gh` credentials in lane env, plus AGENTS.md scope rule against side-effects). When this batch integrates, please post the following on issue #510: *"Superseded by TP-186 (#537, #542) — the death-spiral root cause and structural fix landed there. Closing as superseded; the explicit Order of Operations rule + Recovery Recipe + engine-side `review_step` guard satisfy the original concern about STATUS.md checkpoint discipline at step boundaries."* | Pending operator action at integration | issue #510 |
| **Final test delta:** 3466 pass / 0 fail / 1 skip (= 3452 baseline + 14 new). All new tests in `worker-step-completion-protocol.test.ts`. | Recorded | full suite |
| **PLAN-DRAFT.md:** Created in the task folder for plan review (R001 APPROVE). It is a worker-internal scratch artifact, not part of the deliverable. The supervisor / merge agent may safely leave it in the task folder (it lives under `taskplane-tasks/TP-186-.../`) or strip it during archival — it has no runtime effect either way. | Informational | `taskplane-tasks/TP-186-.../PLAN-DRAFT.md` |
| **No unexpected interactions** between the new prompt sections and the existing review-handling text. The top-of-file task-level `**Status:**` field and the per-step `**Status:**` headings are now distinguished explicitly in the new rule wording. The Option B guard scopes by step heading (`### Step N:`), so the top-of-file field cannot trip it. Verified by test 2.3. | No follow-up needed | `templates/agents/task-worker.md` |
| **No fixtures triggered the guard:** The full suite ran the new `isStepMarkedComplete` helper but no existing test fixture models the death-spiral anti-pattern; nothing else was incidentally caught. | Recorded | full suite run |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-06 23:13 | Task started | Runtime V2 lane-runner execution |
| 2026-05-06 23:13 | Step 0 started | Preflight |
| 2026-05-06 | Baseline tests | 3452 pass / 0 fail / 1 skip |
| 2026-05-06 | Decision | Option A + Option B (prompt edits + engine guard) |
| 2026-05-06 | Step 0 complete | Preflight done; entering Step 1 |
| 2026-05-06 | Step 1 plan review | R001 APPROVE |
| 2026-05-06 | Step 1 complete | Plan APPROVED; baseline SHA captured: 4150207066af63ab5e4fb08c342722d6e45d1e55 |
| 2026-05-06 | Step 2 implementation | task-worker.md prompt edits applied (3 sections inserted in Review Protocol) |
| 2026-05-06 | Step 3 implementation | agent-bridge-extension.ts: `isStepMarkedComplete` helper + guard wired into `review_step` handler |
| 2026-05-06 | Step 4 implementation | worker-step-completion-protocol.test.ts: 14 tests, all pass (3 prompt + 7 helper + 3 wording + 1 regression) |
| 2026-05-06 | Step 5 quality gate | Full suite: 3466 pass / 0 fail / 1 skip; CLI smoke OK |
| 2026-05-06 | Step 5 code review | R002 APPROVE — Steps 2/3/4/5 now safe to mark Complete |
| 2026-05-06 | Step 6 docs | CHANGELOG Unreleased/Fixed entry added; supervisor handover note for issue #510 logged in Discoveries |
| 2026-05-06 | All steps complete | TP-186 done; STATUS ✅ Complete |

---

## Blockers

*None*

---

## Notes

- This task ships in v0.28.6 alone (per supervisor recommendation) so the
  death-spiral fix can be validated in production before subsequent recovery-UX
  work (TP-187, TP-188) lands.
- The worker running this task is itself vulnerable to the bug being fixed.
  Defense: Step 1 plan-review checkpoint catches wording issues early; the
  task is small enough that the worker shouldn't accumulate the long
  multi-step state where the bug bites.
| 2026-05-06 23:17 | Review R001 | plan Step 1: APPROVE |
| 2026-05-06 23:26 | Review R002 | code Step 5: APPROVE |
