# TP-025: RPC Wrapper Script & Exit Classification Types — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read pi RPC docs to understand protocol
- [ ] Read current task outcome types
- [ ] Read naming contract
- [ ] Read roadmap Phase 1 sections

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
