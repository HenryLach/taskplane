# TP-198: Gate ratification record and finalize binding (#627 Stage 2a) — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-09-07
**Review Level:** 3
**Review Counter:** 0
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
**Status:** 🟨 In Progress

- [ ] `GateRatification` type + filename/link helpers + `parseRatificationLink`
- [ ] `validateRatification` with every rejection code from PROMPT.md (injected `isAncestor`)
- [ ] `isRatificationStale`
- [ ] `writeRatification` / `readRatifications` (atomic; malformed throws)
- [ ] `tests/ratification.test.ts` covers each rejection + positive, staleness, round-trip, malformed
- [ ] Targeted tests pass

---

### Step 2: Trusted ratify operation — supervisor tool and operator command
**Status:** ⬜ Not Started

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

### Step 1 design decisions (for plan review)

- **Review file naming:** existing convention is `R{NNN}-{type}-step{N}.md`, gate key = `{type}-step{N}` (from `latestReviewFilesPerGate`). Ratification filename: `ratificationFilename(gate, reviewNumber)` → `R{NNN}-{gate}.ratification.json` (e.g. `R004-code-step3.ratification.json`), NNN zero-padded to 3.
- **Review number derivation for `writeRatification(reviewsDir, record)`:** the record has no explicit reviewNumber field (spec shape fixed). Derive it as (R-number parsed from `supersededReview.path` basename) + 1 — the ratification authorises the NEXT review file after the one it supersedes.
- **`validateRatification` rejection codes:** `unknown-ruling` (no hold whose `ruling.id` === rulingId), `ruling-not-released` (that hold.phase !== "released"), `unknown-escalation` (a closedEscalationId not in holdsForTask), `invalid-ratifier-role` (role not supervisor|operator), `superseded-review-mismatch` (sha256(readFile(path)) !== supersededReview.sha256), `empty-findings`, `no-revision-proof` (proofSet has no kind==="revision"), `revision-not-ancestor` (headRevision given AND !isAncestor(revisionRef, headRevision)). ctx = { holds, reviewsDir, taskId, segmentId, headRevision, readFile, isAncestor }.
- **`isRatificationStale`:** find the APPROVE review file whose content links this record id; stale=true if any higher-numbered review file for the same gate exists (covers "no longer latest" AND "higher REVISE/RETHINK"), or if the link file can't be located (can't confirm freshness → fail safe). ctx = { reviewFilenames, readReview }.
- **sha256:** node `crypto.createHash("sha256")` over file content (utf-8).
- **atomic write:** tmp file + `renameSync`, `JSON.stringify(record, null, 2)`.
