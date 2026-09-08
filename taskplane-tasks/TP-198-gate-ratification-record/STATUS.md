# TP-198: Gate ratification record and finalize binding (#627 Stage 2a) — Status

**Current Step:** Step 2: Trusted ratify operation
**Status:** 🟡 In Progress
**Last Updated:** 2026-09-07
**Review Level:** 3
**Review Counter:** 2
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] `hold-state.ts` exports confirmed (HoldRecord, HoldRuling, RulingActor, evaluateCompletionAuthority, holdsForTask)
- [x] `review-analysis.ts` exports confirmed (parseReviewVerdict, latestReviewFilesPerGate)
- [x] Full-suite baseline recorded (pass/fail counts, lint warning count)

**Baseline (Step 0):** tests 4018, pass 4016, fail 1 (pre-existing: `project-config-loader.test.ts:1619` "repo mode — pointer is not consulted", unrelated to TP-198). Lint: 283 warnings, 677 infos.

---

### Step 1: `ratification.ts` — record, validation, staleness (pure module)
**Status:** ✅ Implemented (code review batched into Step 3 checkpoint)

- [x] `GateRatification` type + filename/link helpers + `parseRatificationLink`
- [x] `validateRatification` with every rejection code from PROMPT.md (injected `isAncestor`)
- [x] `isRatificationStale`
- [x] `writeRatification` / `readRatifications` (atomic; malformed throws)
- [x] `tests/ratification.test.ts` covers each rejection + positive, staleness, round-trip, malformed
- [x] Targeted tests pass (29/29)

---

### Step 2: Trusted ratify operation — supervisor tool and operator command
**Status:** 🟨 In Progress

**Design:** shared `doRatifyGate(params, actor, stateRoot)` helper in extension.ts (mirrors `doSendAgentMessage`). Loads batch state, finds task+lane, resolves reviewsDir via `resolveCanonicalTaskPaths`, picks the gate's latest review file as `supersededReview` (path relative to reviewsDir + sha256), derives `segmentId`/`closedEscalationIds` from the hold carrying `rulingId`, builds the record, validates with real git (`runGit rev-parse HEAD`, `merge-base --is-ancestor`), and ONLY on success allocates the next R number from STATUS.md `**Review Counter:**` (persisted back), writes `R{N}-{gate}.md` (APPROVE + summary + findings table + `Ratification: <id>`) AND `writeRatification(...,N)`, then audits via `logRecoveryAction` (`gate_ratified`, destructive). On validation failure: writes nothing, returns the code+reason. Tool stamps `{role:"supervisor"}` (marker `RATIFY-SUPERVISOR-STAMP`); `/orch-ratify` stamps `{role:"operator"}` (marker `RATIFY-OPERATOR-STAMP`, the only operator ratifier site). Empty findings → synthesized single `ruled` finding citing the ruling (operator command path).

- [ ] `ratify_gate` tool: builds + validates record, writes record and linked APPROVE review, stamps `supervisor`
- [ ] Audit entry via `appendAuditEntry` (`gate_ratified`)
- [ ] `/orch-ratify` command stamps `operator` (only site)
- [ ] Tool guidelines state the sequencing invariant
- [ ] Wiring assertions in `tests/ratification-finalize.test.ts`
- [ ] Targeted tests pass

---

### Step 3: Finalize gate binding in the lane-runner
**Status:** ⬜ Not Started

- [ ] `ReviewInterventionKind` gains `"invalid-ratification"`
- [ ] `findBlockingReviewGates` treats a linked APPROVE without a valid, non-stale record as blocking (reason carried)
- [ ] Refusal path emits `review_gate_refusal` + `invalid-ratification` alert naming id and reason
- [ ] Unlinked APPROVE unchanged (not blocking)
- [ ] Behavioural tests (a)–(d) with real `executeTaskV2` + mocked `spawnAgent`
- [ ] Targeted tests pass

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing (vs Step 0 baseline)
- [ ] typecheck 0 errors
- [ ] lint at or below baseline (both numbers recorded)
- [ ] format:check clean
- [ ] CLI help + doctor exit 0

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Primer: ratification recipe replaces hand-written APPROVE recipe
- [ ] commands.md: `/orch-ratify`
- [ ] Spec status + Stage 2a note
- [ ] CHANGELOG `[Unreleased]` entry
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
| 2026-09-08 | Task staged | PROMPT.md and STATUS.md created |
| 2026-09-07 23:47 | Task started | Runtime V2 lane-runner execution |
| 2026-09-07 23:47 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

### Step 1 design decisions (revised after R001-plan-step1 REVISE)

- **Review file naming:** existing convention is `R{NNN}-{type}-step{N}.md`, gate key = `{type}-step{N}` (from `latestReviewFilesPerGate`). R numbers are **globally allocated** from `**Review Counter:**` in STATUS.md (see `agent-bridge-extension.ts:900`), NOT per-gate. Ratification filename: `ratificationFilename(gate, reviewNumber)` → `R{NNN}-{gate}.ratification.json`, NNN zero-padded to 3.
- **[R001 issue 2] Review number is a single allocation owned by the tool (Step 2), NOT derived from `supersededReview+1`.** Step 2 reads `**Review Counter:**`, increments, persists it back, and uses that one N for BOTH `R{N}-{gate}.md` (APPROVE markdown) and the ratification JSON. To keep the number consistent between the two files, `writeRatification(reviewsDir, record, reviewNumber)` takes the allocated number explicitly (a documented deviation from the PROMPT's `(reviewsDir, record)` signature — recorded as an Amendment — required to avoid the collision the reviewer flagged).
- **[R001 issue 1] Scope binding — `validateRatification` rejection codes:** `malformed-record` (structural guard fails), `wrong-task` (record.taskId !== ctx.taskId), `wrong-segment` ((record.segmentId ?? null) !== (ctx.segmentId ?? null)), `unknown-ruling` (no hold whose `ruling.id` === rulingId **among holds that bind this unit** via `holdsForUnit`), `ruling-not-released` (that hold.phase !== "released"), `unknown-escalation` (a closedEscalationId not in `holdsForTask`), `invalid-ratifier-role` (role not supervisor|operator), `superseded-review-out-of-scope` (path is absolute/contains `..`, or basename doesn't match `R\d+-{record.gate}.md`), `superseded-review-mismatch` (sha256(readFile(join(reviewsDir,path))) !== supersededReview.sha256), `empty-findings`, `no-revision-proof` (proofSet has no kind==="revision"), `revision-not-ancestor` (headRevision given AND !isAncestor(revisionRef, headRevision)). `supersededReview.path` is stored **relative to reviewsDir** (a filename), keeping it portable. ctx = { holds, reviewsDir, taskId, segmentId, headRevision, readFile, isAncestor }.
- **[R001 issue 3] Structural decoding:** `isValidGateRatification(obj): obj is GateRatification` validates every field type (arrays are arrays, proofSet has revision shape, etc.). `readRatifications` throws on BOTH invalid JSON AND structurally-invalid JSON. `validateRatification` runs the guard first and returns `malformed-record` rather than casting a bad shape.
- **[R001 suggestion] `isRatificationStale`:** locate the review file for `record.gate` whose content `parseRatificationLink === record.id` AND `parseReviewVerdict === APPROVE`. Missing / ambiguous / wrong-gate / non-APPROVE link → stale (fail-closed). Otherwise stale=true iff any higher-numbered `R\d+-{gate}.md` review file exists (covers "no longer latest" AND "higher REVISE/RETHINK"). ctx = { reviewFilenames, readReview }.
- **sha256:** node `crypto.createHash("sha256")` over file content (utf-8).
- **atomic write:** tmp file + `renameSync`, `JSON.stringify(record, null, 2)`.
- **New Step 1 tests (from R001 Missing Items):** wrong-task & wrong-segment ruling references rejected; superseded-review wrong-gate / path-traversal rejected; structurally-valid-JSON-but-bad-shape read throws (in addition to invalid-JSON). Interleaved-gate numbering/collision + subsequent ordinary review allocation is a Step 2 test (global counter) — tracked there.
| 2026-09-07 23:53 | Review R001 | plan Step 1: REVISE |
| 2026-09-07 23:56 | Review R002 | plan Step 1: APPROVE |
