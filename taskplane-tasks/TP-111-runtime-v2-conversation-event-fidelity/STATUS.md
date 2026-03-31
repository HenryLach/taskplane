# TP-111: Runtime V2 Conversation Event Fidelity — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-31
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Trace current Runtime V2 event emission and payloads
- [ ] Compare against dashboard renderer and observability spec expectations

---

### Step 1: Runtime V2 conversation event emission
**Status:** ⬜ Not Started

- [ ] Emit `prompt_sent` with bounded payload
- [ ] Emit `assistant_message` with bounded payload
- [ ] Preserve existing lifecycle/tool/telemetry events
- [ ] Validate payload bounds and compatibility

---

### Step 2: Dashboard rendering parity
**Status:** ⬜ Not Started

- [ ] Align `renderV2Event(...)` mappings to emitted payload contracts
- [ ] Ensure coherent normalized-event conversation rendering
- [ ] Keep legacy fallback secondary

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/extend tests for prompt/assistant normalized events
- [ ] Run targeted tests
- [ ] Run full suite
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update Runtime V2 observability docs
- [ ] Log discoveries in STATUS.md

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
| 2026-03-31 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
