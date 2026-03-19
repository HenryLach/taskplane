# TP-025: RPC Wrapper Script & Exit Classification Types — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read pi RPC docs to understand protocol
- [x] Read current task outcome types
- [x] Read naming contract
- [x] Read roadmap Phase 1 sections

---

### Step 1: Define TaskExitDiagnostic Type & Classification Logic
**Status:** ⬜ Not Started

- [ ] TaskExitDiagnostic interface with all fields
- [ ] classifyExit() function with all 9 classification paths
- [ ] TokenCounts interface
- [ ] Types exported for downstream use

---

### Step 2: Build RPC Wrapper Script
**Status:** ⬜ Not Started

- [ ] CLI arg parsing
- [ ] Spawn pi --mode rpc --no-session
- [ ] Send prompt via JSONL framing
- [ ] Route and capture RPC events to sidecar JSONL
- [ ] Redaction policy applied
- [ ] Live progress display on stderr
- [ ] Exit summary JSON on process exit
- [ ] Signal forwarding and crash handling

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit tests for classifyExit()
- [ ] Unit tests for redaction logic
- [ ] Unit tests for exit summary accumulation
- [ ] Integration test with mock RPC process
- [ ] Full test suite passes
- [ ] rpc-wrapper.mjs runs

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] JSDoc on exported types and functions
- [ ] Usage comment in rpc-wrapper.mjs
- [ ] package.json files array updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-19 18:01 | Task started | Extension-driven execution |
| 2026-03-19 18:01 | Step 0 started | Preflight |
| 2026-03-19 18:01 | Task started | Extension-driven execution |
| 2026-03-19 18:01 | Step 0 started | Preflight |
| 2026-03-19 18:01 | Review R001 | plan Step 0: APPROVE |
| 2026-03-19 18:02 | Review R001 | plan Step 0: APPROVE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
