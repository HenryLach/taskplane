# TP-094: Context Pressure and Telemetry Accuracy Fix — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-29
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Verify field name mismatch in real sidecar data
- [ ] Trace all percentUsed code paths
- [ ] Identify manual fallback removal points

---

### Step 1: Fix field name mismatch in sidecar tailing
**Status:** ⬜ Not Started

- [ ] Fix percent vs percentUsed in tailSidecarJsonl
- [ ] Verify rpc-wrapper field extraction
- [ ] Remove manual token fallback from threshold decisions

---

### Step 2: Context % snapshots at iteration boundaries
**Status:** ⬜ Not Started

- [ ] Write JSONL snapshot at worker iteration end
- [ ] Add to batch artifact cleanup

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Tests for correct field extraction
- [ ] Full test suite passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Log discoveries

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
| 2026-03-29 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
