# Task: TP-198 - Gate ratification record and finalize binding (#627 Stage 2a)

**Created:** 2026-09-08
**Size:** L

## Review Level: 3 (Full)

**Assessment:** This introduces a new authority artifact that the finalize gate will trust, touches the lane-runner's completion path, the supervisor tool surface and an operator command, and a mistake fails open (unreviewed work merges). New pattern, multiple modules, authority semantics.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 1

## Canonical Task Folder

```
C:/dev/taskplane/taskplane-tasks/TP-198-gate-ratification-record/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Give the "delegated closure" pattern a first-class, verifiable record. Today, when a review gate hits the revision cap, the supervisor rules on in-authority findings, escalates the operator's reserved decisions, verifies the worker's fold, and then hand-writes the next R-numbered review file with `Verdict: APPROVE`. The runtime only sees "latest review file says APPROVE" — it cannot tell a ratified closure from a forged one, cannot tie it to the ruling that authorized it, and cannot notice that the code changed after the ratification. This task adds the **`GateRatification` record**: a structured, validated artifact written by a trusted operation (supervisor tool or operator command), linked from the APPROVE review file it authorizes, and **required by the finalize gate** whenever an APPROVE file claims ratification. A ruling releases execution; a ratification is what makes the resulting gate closure trustworthy. Design: `docs/specifications/taskplane/held-state-spec.md` §"Finalize: permission to resume ≠ permission to finalize". Stage 1 (durable holds, typed rulings) is already on this build — reuse its types and helpers, do not re-implement them.

## Dependencies

- **None** (Stage 1 of #627 is merged into the base branch this task runs on: `extensions/taskplane/hold-state.ts` exists and exports `HoldRecord`, `HoldRuling`, `RulingActor`, `evaluateCompletionAuthority`, `holdsForTask`)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/held-state-spec.md` — the design this task implements; read §Data (`GateRatification`), §Finalize, §Staging (Stage 2)
- `extensions/taskplane/hold-state.ts` — hold/ruling types and `evaluateCompletionAuthority`; the ratification module must compose with these, not duplicate them
- `extensions/taskplane/review-analysis.ts` — `parseReviewVerdict`, `latestReviewFilesPerGate` (the finalize gate's existing scanner)
- `extensions/taskplane/lane-runner.ts` — search for `findBlockingReviewGates` and `review_gate_refusal`; that is the finalize gate you are extending
- `extensions/taskplane/supervisor.ts` — `appendAuditEntry` / `logRecoveryAction` (audit-trail writer the ratify operation must use)

## Environment

- **Workspace:** `extensions/taskplane/` (runtime) and `extensions/tests/` (Node test runner, `.test.ts`)
- **Services required:** None

## File Scope

- `extensions/taskplane/ratification.ts` (new)
- `extensions/taskplane/types.ts` (new `ReviewInterventionKind` member; `GateRatification` re-export if needed)
- `extensions/taskplane/lane-runner.ts` (finalize gate: `findBlockingReviewGates` / refusal path)
- `extensions/taskplane/extension.ts` (new `ratify_gate` tool, `/orch-ratify` command)
- `extensions/taskplane/supervisor-primer.md` (ratification recipe replaces the hand-written APPROVE recipe)
- `extensions/tests/ratification.test.ts` (new)
- `extensions/tests/ratification-finalize.test.ts` (new)
- `docs/reference/commands.md`, `docs/specifications/taskplane/held-state-spec.md`, `CHANGELOG.md`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] `extensions/taskplane/hold-state.ts` exports `HoldRecord`, `HoldRuling`, `RulingActor`, `evaluateCompletionAuthority`, `holdsForTask` (confirm with grep — do not proceed if absent)
- [ ] `extensions/taskplane/review-analysis.ts` exports `parseReviewVerdict` and `latestReviewFilesPerGate`
- [ ] Full suite baseline recorded in STATUS.md (`cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`) — note pass/fail counts

### Step 1: `ratification.ts` — record, validation, staleness (pure module)

**Plan-review checkpoint** — this step fixes the record shape and the validation rules everything else depends on.

- [ ] Create `extensions/taskplane/ratification.ts` exporting `GateRatification` exactly as in the spec: `{ id, taskId, segmentId: string|null, gate, rulingId, ratifier: RulingActor, closedEscalationIds: string[], supersededReview: { path, sha256 }, findings: Array<{ ref, disposition: "fixed"|"ruled", evidenceRefs: string[] }>, proofSet: Array<{ kind: "revision"|"artifact", ref: string, sha256?: string }>, createdAt: number }`
- [ ] Export `ratificationFilename(gate, reviewNumber)` → `R00N-<gate>.ratification.json` and `ratificationLinkLine(id)` → the exact line the APPROVE review file must contain (`Ratification: <id>`), plus `parseRatificationLink(reviewMarkdown): string | null`
- [ ] Export `validateRatification(record, ctx)` returning `{ ok: true } | { ok: false; code; reason }` where `ctx = { holds: HoldRecord[], reviewsDir, taskId, segmentId, headRevision: string|null, readFile }`. It MUST reject: unknown `rulingId` (no hold whose `ruling.id` matches), a ruling whose hold is not `released`, `closedEscalationIds` not all present in `holds` for this task, `ratifier.role` not `supervisor|operator`, an `operator`-role record whose linked ruling was issued by a `supervisor` actor when the ruling was for an operator-reserved decision is NOT something the runtime can know — do not invent that check; `supersededReview.sha256` not matching the current content of `supersededReview.path`, empty `findings`, a `proofSet` with no `revision` entry, and (when `headRevision` is given) a revision proof that is not an ancestor-or-equal of `headRevision` (inject `isAncestor(a, b)` via ctx so tests need no git)
- [ ] Export `isRatificationStale(record, ctx)` → true when a review file for the same gate with a HIGHER review number than the ratified APPROVE exists and reads REVISE/RETHINK, or when the ratified APPROVE file is no longer the latest for its gate
- [ ] Export `writeRatification(reviewsDir, record)` (atomic tmp+rename, pretty JSON) and `readRatifications(reviewsDir): GateRatification[]` (malformed file → throw, never skip)
- [ ] Create `extensions/tests/ratification.test.ts` covering: filename/link round-trip; every rejection code above with one positive case; staleness true/false; write/read round-trip; malformed file throws
- [ ] Run targeted tests: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/ratification.test.ts`

**Artifacts:**
- `extensions/taskplane/ratification.ts` (new)
- `extensions/tests/ratification.test.ts` (new)

### Step 2: Trusted ratify operation — supervisor tool and operator command

- [ ] In `extensions/taskplane/extension.ts` register tool `ratify_gate(taskId, gate, rulingId, summary, findings, proofRevision, artifactRefs?)`: loads batch state, locates the task folder and its `reviews/` dir, determines the next review number for `gate`, builds the `GateRatification` with `ratifier = { role: "supervisor", id: "supervisor" }` (stamped by the tool — never from a parameter), `supersededReview` = the current latest review file for that gate (path + sha256 of its content), `proofSet` = `[{ kind: "revision", ref: proofRevision }, ...artifactRefs]`, validates it with `validateRatification` (real `git merge-base --is-ancestor` for `isAncestor`, worktree HEAD as `headRevision`), and on success writes the record AND the next R-numbered review markdown containing `Verdict: APPROVE`, the summary, the findings table (ref / disposition / evidence), and the `Ratification: <id>` link line. On validation failure it writes nothing and returns the reason.
- [ ] The tool appends an audit entry via `appendAuditEntry` (action `gate_ratified`, classification `destructive`, task/gate/ruling/ratification ids in detail) — code-stamped, never hand-written
- [ ] Register command `/orch-ratify <taskId> <gate> <rulingId> <proofRevision> -- <summary>` that performs the same operation with `ratifier = { role: "operator", id: <operator id> }` (the ONLY path that stamps `operator`, mirroring `/orch-rule`)
- [ ] Tool `promptGuidelines` state the sequencing invariant: ruling → fold → verification → **ratify_gate** → (the APPROVE file it writes) → `.DONE`; the worker never writes the APPROVE file itself
- [ ] Add wiring assertions to `extensions/tests/ratification-finalize.test.ts` (created in this step; source-based for the tool/command registration and the single `role: "operator"` stamp site for ratification)
- [ ] Run targeted tests: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/ratification-finalize.test.ts`

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)
- `extensions/tests/ratification-finalize.test.ts` (new)

### Step 3: Finalize gate binding in the lane-runner

**Code review checkpoint** — review Steps 1–3 together here.

- [ ] Add `ReviewInterventionKind` member `"invalid-ratification"` in `extensions/taskplane/types.ts`
- [ ] Extend `findBlockingReviewGates(reviewsDir)` in `extensions/taskplane/lane-runner.ts` (or a sibling helper it calls) so that a gate whose LATEST review file reads APPROVE **and carries a `Ratification:` link** is blocking unless `readRatifications` yields a record with that id that passes `validateRatification` (holds from `config.holdStore.list()`, `headRevision` = worktree HEAD, real `isAncestor`) and is not `isRatificationStale`. The `BlockingReviewGate` for this case carries `verdict: "APPROVE"` and a new `reason` field naming the validation code
- [ ] The finalize refusal path emits the existing `review_gate_refusal` classification with `reviewInterventionKind: "invalid-ratification"` and an alert whose summary names the ratification id and the reason (missing record, invalid: <code>, stale)
- [ ] An APPROVE file WITHOUT a `Ratification:` link keeps today's behaviour (not blocking) — this task does not implement the full coverage gate (#626)
- [ ] Behavioural tests in `extensions/tests/ratification-finalize.test.ts` using the real `executeTaskV2` with `spawnAgent` mocked (follow `extensions/tests/held-state-runner.test.ts` for the harness): (a) ratified APPROVE with a valid record → task succeeds and `.DONE` is written; (b) APPROVE claiming a ratification id with no record → refused, `invalid-ratification`, no `.DONE`; (c) valid record but a later REVISE review for the same gate → stale → refused; (d) record whose `supersededReview.sha256` no longer matches → refused
- [ ] Run targeted tests for both new files

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified)
- `extensions/taskplane/types.ts` (modified)
- `extensions/tests/ratification-finalize.test.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts` — compare against the Step 0 baseline; every pre-existing test still passes
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run lint` → warning count not above the Step 0 baseline (record both numbers in STATUS.md)
- [ ] `npm run format:check` → clean (run `npm run format` first if needed)
- [ ] `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor` exit 0

### Step 5: Documentation & Delivery

- [ ] `extensions/taskplane/supervisor-primer.md`: replace the "record the ruling as the next R-numbered review file with an explicit APPROVE verdict" recipe (search for it under `kind = "unresolved-verdict"`) with the `ratify_gate` recipe and the sequencing invariant
- [ ] `docs/reference/commands.md`: add `/orch-ratify` next to `/orch-rule`
- [ ] `docs/specifications/taskplane/held-state-spec.md`: mark Stage 2a implemented; note the record filename and link line
- [ ] `CHANGELOG.md` `[Unreleased]` → `### New`: one entry for the ratification record + finalize binding (name the tool, the command, the refusal kind)
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/supervisor-primer.md` — ratification recipe
- `docs/reference/commands.md` — `/orch-ratify`
- `CHANGELOG.md` — `[Unreleased]` entry

**Check If Affected:**
- `docs/specifications/taskplane/held-state-spec.md` — status line and Stage 2 section
- `templates/agents/supervisor.md` — if it mentions writing APPROVE files by hand, point it at `ratify_gate`

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (full suite, typecheck, lint at or below baseline, format)
- [ ] Documentation updated

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-198): complete Step N — description`
- **Bug fixes:** `fix(TP-198): description`
- **Tests:** `test(TP-198): description`
- **Hydration:** `hydrate: TP-198 expand Step N checkboxes`

## Do NOT

- Re-implement holds, rulings or `evaluateCompletionAuthority` — import them from `hold-state.ts`
- Let the worker (you) write an APPROVE review file to satisfy a gate; if a gate is at its cap, `escalate_to_supervisor` and hold — the runtime will hold the lane and deliver the ruling
- Make an APPROVE file without a `Ratification:` link blocking (that is #626's coverage gate, out of scope)
- Read `ratifier.role` from a tool parameter — the issuing path stamps it
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
