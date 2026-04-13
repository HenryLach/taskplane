# TP-173: Discovery Segment-Step Parsing — Status

**Current Step:** Step 1: Add Types
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-13
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read discovery.ts PROMPT.md parser
- [x] Read types.ts ParsedTask interface
- [x] Read spec sections A.1 and A.10
- [x] Document findings

---

### Step 1: Add Types
**Status:** ✅ Complete
- [x] Add SegmentCheckboxGroup interface
- [x] Add StepSegmentMapping interface
- [x] Add stepSegmentMap to ParsedTask
- [x] Run targeted tests

---

### Step 2: Implement Segment Parsing
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on parser structure found in Step 0

- [ ] Parse `#### Segment: <repoId>` within step sections
- [ ] Collect checkboxes per segment
- [ ] Handle fallback (no markers → primary repoId)
- [ ] Handle edge cases (empty, duplicate, unknown repoId)
- [ ] Run targeted tests

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started
- [ ] FULL test suite passing
- [ ] Tests for segment markers, fallback, mixed, errors
- [ ] All failures fixed

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| parsePromptForOrchestrator() extracts ID, review, size, deps, file scope, exec target, segment DAG. Does NOT parse step sections/checkboxes. | Expected — new parsing needed | discovery.ts:356-576 |
| ParsedTask already has explicitSegmentDag, packetRepoId, segmentIds, activeSegmentId fields. stepSegmentMap is new. | Add as optional field | types.ts:91-131 |
| Spec A.1 defines SegmentCheckboxGroup {repoId, checkboxes[]} and StepSegmentMapping {stepNumber, stepName, segments[]} | Implement as specified | segment-aware-steps.md A.1 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-13 16:01 | Task started | Runtime V2 lane-runner execution |
| 2026-04-13 16:01 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

Phase A foundation task. All other Phase A tasks depend on this.
Specification: docs/specifications/taskplane/segment-aware-steps.md
| 2026-04-13 16:03 | Review R001 | plan Step 1: APPROVE |
