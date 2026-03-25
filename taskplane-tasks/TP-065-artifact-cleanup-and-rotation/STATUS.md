# TP-065: Artifact Cleanup and Log Rotation — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-25
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read integrate cleanup logic in extension.ts
- [ ] Read telemetry path generation in execution.ts
- [ ] Read merge result naming in merge.ts
- [ ] Find preflight hook in engine.ts

---

### Step 1: Post-Integrate Cleanup (Layer 1)
**Status:** ⬜ Not Started
- [ ] Delete batch-specific telemetry files after integrate
- [ ] Delete merge result files after integrate
- [ ] Guard: only clean completed batches, log results

---

### Step 2: Age-Based Sweep on Preflight (Layer 2)
**Status:** ⬜ Not Started
- [ ] Sweep telemetry/merge files older than 7 days
- [ ] Guard: skip if batch is actively executing
- [ ] Non-fatal with logging

---

### Step 3: Size-Capped Rotation for Append-Only Logs (Layer 3)
**Status:** ⬜ Not Started
- [ ] Rotate events.jsonl and actions.jsonl at 5MB threshold
- [ ] Keep one .old generation
- [ ] Only rotate during preflight

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Create artifact-cleanup.test.ts
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update troubleshooting docs
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*
