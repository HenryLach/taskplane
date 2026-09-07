# Task: TP-199 - Ruling commit trailer validation and unified `.DONE` authority (#627 Stage 2b)

**Created:** 2026-09-08
**Size:** M

## Review Level: 3 (Full)

**Assessment:** Extends the completion-authority predicate to resume's `.DONE` acceptance and adds runtime validation of ruling citations in commits; a mistake either fails open (unratified work accepted on resume) or produces false audit flags. Touches lane-runner, resume and the audit trail.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 1

## Canonical Task Folder

```
C:/dev/taskplane/taskplane-tasks/TP-199-ruling-trailer-and-done-authority/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Two remaining gaps from the #627 design. **(1) Commit citations are unverifiable.** TP-2037's worker committed "R004 cap ruling (FIX)" with no ruling in existence. Workers must cite rulings only via a structured trailer, `Taskplane-Ruling: <ruling id>`, and the runtime must validate every citation against the durable hold table: an unknown id, an id whose hold belongs to another unit, or a prose claim of a ruling with no trailer is **flagged** in the supervisor audit trail (`actions.jsonl`) and surfaced to the supervisor — never treated as approval. **(2) `.DONE` acceptance is not one predicate.** The lane-runner's finalize gate (holds + review gates + ratification, after TP-198) is the authority on completion, but resume's `.DONE` collection only checks the segment frontier. Introduce `authorizeCompletion()` — one exported predicate combining hold authority (`evaluateCompletionAuthority`), blocking review gates and ratification validity — and call it from the lane-runner finalize path AND from resume's `.DONE` acceptance so a worker-written `.DONE` over a blocking gate is refused on resume exactly as it is live. Design: `docs/specifications/taskplane/held-state-spec.md` §Finalize.

## Dependencies

- **Task:** TP-198 (`ratification.ts` with `validateRatification` / `isRatificationStale` / `readRatifications` must exist; the lane-runner's `findBlockingReviewGates` must already understand linked APPROVE files)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/held-state-spec.md` — §Finalize (trailer, `authorizeCompletion`)
- `extensions/taskplane/hold-state.ts` — `evaluateCompletionAuthority`, `holdsForTask`, `HoldRecord.ruling`
- `extensions/taskplane/ratification.ts` — from TP-198
- `extensions/taskplane/lane-runner.ts` — `findBlockingReviewGates`, the finalize section (`review_gate_refusal`), the post-iteration block after `drainAndSurfaceOutbox()`
- `extensions/taskplane/resume.ts` — `collectDoneTaskIdsForResume`, `quarantineUnauthorizedDoneMarkers`
- `extensions/taskplane/supervisor.ts` — `appendAuditEntry`

## Environment

- **Workspace:** `extensions/taskplane/` and `extensions/tests/`
- **Services required:** None (tests create throwaway git repos with `git init`)

## File Scope

- `extensions/taskplane/completion-authority.ts` (new)
- `extensions/taskplane/lane-runner.ts` (finalize path; post-iteration commit scan)
- `extensions/taskplane/resume.ts` (`collectDoneTaskIdsForResume`)
- `extensions/taskplane/hold-state.ts` (only if a small helper is needed; do not move existing exports)
- `extensions/taskplane/supervisor-primer.md`, `templates/agents/task-worker.md` (trailer contract)
- `extensions/tests/completion-authority.test.ts` (new)
- `extensions/tests/ruling-trailer.test.ts` (new)
- `CHANGELOG.md`, `docs/specifications/taskplane/held-state-spec.md`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] TP-198 artifacts present: `extensions/taskplane/ratification.ts` exports `validateRatification`, `isRatificationStale`, `readRatifications`, `parseRatificationLink`
- [ ] Full suite baseline recorded in STATUS.md (pass/fail counts, lint warning count)

### Step 1: `completion-authority.ts` — one predicate

**Plan-review checkpoint.**

- [ ] Create `extensions/taskplane/completion-authority.ts` exporting `authorizeCompletion(ctx): CompletionDecision` where `ctx = { holds: HoldRecord[], taskId, segmentId, reviewsDir, headRevision: string|null, isAncestor(a,b): boolean, isFinalSegment: boolean }` and `CompletionDecision = { allowed: true } | { allowed: false; blockers: Array<{ kind: "hold"|"review-gate"|"ratification"; ref: string; reason: string }> }`
- [ ] It composes, in this order and short-circuiting nothing (report ALL blockers): `evaluateCompletionAuthority` (holds) → blocking review gates (latest REVISE/RETHINK per gate, via `latestReviewFilesPerGate` + `parseReviewVerdict`) → linked-APPROVE ratification validity (`parseRatificationLink` + `readRatifications` + `validateRatification` + `isRatificationStale`). Non-final segments skip the review/ratification checks (mirror today's `isNonFinalSegment` behaviour) but never skip hold authority
- [ ] Refactor the lane-runner's finalize path to call `authorizeCompletion` instead of its separate `completionAuthority()` + `findBlockingReviewGates` calls; keep the alert kinds (`unresolved-verdict`, `invalid-ratification`) and the `review_gate_refusal` classification exactly as today — this is a consolidation, behaviour must not change (existing tests are the oracle)
- [ ] Create `extensions/tests/completion-authority.test.ts`: allowed; hold-blocked only; review-gate-blocked only; ratification-blocked only; all three reported together; non-final segment ignores review gates but not holds
- [ ] Run targeted tests: the new file plus `tests/held-state-runner.test.ts`, `tests/review-remediation-spawn.test.ts`, `tests/ratification-finalize.test.ts`

**Artifacts:**
- `extensions/taskplane/completion-authority.ts` (new)
- `extensions/taskplane/lane-runner.ts` (modified)
- `extensions/tests/completion-authority.test.ts` (new)

### Step 2: Resume `.DONE` acceptance uses the same predicate

- [ ] In `extensions/taskplane/resume.ts`, `collectDoneTaskIdsForResume` (or the caller) must refuse a `.DONE` when `authorizeCompletion` is not allowed for that task (holds from `persistedState.holds`, `reviewsDir` resolved from the task folder / worktree like `donePath`, `headRevision` from the lane worktree when it exists, `isFinalSegment` from the segment frontier). A refused `.DONE` is logged (`[resume] WARN … refused by completion authority: <blockers>`) and the task is reconciled as it would be without the marker (re-execute into the gate/hold), never `mark-complete`
- [ ] Behavioural test in `extensions/tests/completion-authority.test.ts` (or a sibling) using the real `collectDoneTaskIdsForResume` on a temp folder: `.DONE` present + latest review REVISE → not collected; `.DONE` present + APPROVE (unlinked) → collected; `.DONE` + linked APPROVE with a missing ratification record → not collected
- [ ] Run targeted tests: new tests plus `tests/held-state-recovery.test.ts`, `tests/resume-bug-fixes.test.ts`

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified)
- `extensions/tests/completion-authority.test.ts` (modified)

### Step 3: `Taskplane-Ruling:` trailer validation

**Code review checkpoint** — review Steps 1–3 together here.

- [ ] Export from `completion-authority.ts` (or a small `ruling-trailer.ts` — your call, name it in STATUS.md) `parseRulingCitations(commitMessage): { trailerIds: string[]; proseClaims: string[] }` — trailer lines `Taskplane-Ruling: <id>[, <id>…]`; prose claims = lines matching `/\b(cap )?ruling\b/i` outside a trailer (record the line text)
- [ ] Export `validateRulingCitations(citations, holds, unit): RulingCitationFlag[]` where a flag is `{ kind: "unknown-ruling"|"wrong-unit"|"prose-claim"; ref: string; reason: string }` — an id is valid only when some hold **binding this unit** has `ruling.id === id`
- [ ] In the lane-runner, after each iteration (after `drainAndSurfaceOutbox()` in the post-exit block), list the commits the worker created this iteration (`git log --format=%H%x00%B%x00 <iterationStartSha>..HEAD` in the worktree; record `iterationStartSha` before spawn) and run the two functions. For every flag: `logExecution(statusPath, "Ruling citation flagged", …)`, append an audit entry via `appendAuditEntry` (action `ruling_citation_flagged`, classification `diagnostic`, task/lane/commit/flag in detail) and emit ONE supervisor alert per iteration listing the flags. Flags never change task status, never release a hold and never count toward stall
- [ ] `templates/agents/task-worker.md`: document the trailer contract (cite rulings ONLY via `Taskplane-Ruling: <id>`; never claim a ruling in prose; a ruling releases execution, it does not approve)
- [ ] Create `extensions/tests/ruling-trailer.test.ts`: parser (single, multiple, none, prose claim); validator (valid, unknown, other-unit, prose); behavioural lane-runner test with a real `git init` worktree where the mocked worker commits (a) a valid trailer → no flag, (b) an unknown id → `unknown-ruling` flag + audit entry + alert, (c) prose "R004 cap ruling (FIX)" without trailer → `prose-claim` flag; task status unaffected in all three
- [ ] Run targeted tests: the new file plus `tests/held-state-runner.test.ts`

**Artifacts:**
- `extensions/taskplane/completion-authority.ts` or `extensions/taskplane/ruling-trailer.ts` (new/modified)
- `extensions/taskplane/lane-runner.ts` (modified)
- `templates/agents/task-worker.md` (modified)
- `extensions/tests/ruling-trailer.test.ts` (new)

### Step 4: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts` — every pre-existing test still passes
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → warning count not above the Step 0 baseline
- [ ] `npm run format:check` → clean
- [ ] `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor` exit 0

### Step 5: Documentation & Delivery

- [ ] `extensions/taskplane/supervisor-primer.md`: describe the `Ruling citation flagged` alert and what to do (it is evidence of a worker claiming authority — read the commit, rule or ratify properly; never approve because a commit says so)
- [ ] `docs/specifications/taskplane/held-state-spec.md`: mark Stage 2b implemented
- [ ] `CHANGELOG.md` `[Unreleased]` → `### New`: entry for `authorizeCompletion` on resume + trailer validation
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `templates/agents/task-worker.md` — trailer contract
- `extensions/taskplane/supervisor-primer.md` — citation-flag alert
- `CHANGELOG.md` — `[Unreleased]` entry

**Check If Affected:**
- `docs/specifications/taskplane/held-state-spec.md` — status line
- `docs/reference/status-format.md` — if it lists execution-log actions, add `Ruling citation flagged`

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (full suite, typecheck, lint at or below baseline, format)
- [ ] Documentation updated

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-199): complete Step N — description`
- **Bug fixes:** `fix(TP-199): description`
- **Tests:** `test(TP-199): description`
- **Hydration:** `hydrate: TP-199 expand Step N checkboxes`

## Do NOT

- Change what the lane-runner finalize gate accepts or refuses — Step 1 is a consolidation; the existing tests are the oracle
- Let a citation flag change task status, release a hold, or count as progress or stall
- Cite a ruling yourself in any commit message for this task (you have none) — if you are held and receive one, cite it ONLY via the trailer
- Make an unlinked APPROVE blocking (#626, out of scope)
- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
