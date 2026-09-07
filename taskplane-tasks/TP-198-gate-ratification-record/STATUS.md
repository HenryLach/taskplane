# TP-198: Gate ratification record and finalize binding (#627 Stage 2a) — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-09-08
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] `hold-state.ts` exports confirmed (HoldRecord, HoldRuling, RulingActor, evaluateCompletionAuthority, holdsForTask)
- [ ] `review-analysis.ts` exports confirmed (parseReviewVerdict, latestReviewFilesPerGate)
- [ ] Full-suite baseline recorded (pass/fail counts, lint warning count)

---

### Step 1: `ratification.ts` — record, validation, staleness (pure module)
**Status:** ⬜ Not Started

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
