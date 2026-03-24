## Plan Review: Step 3 — Testing & Verification

### Verdict: REVISE

### Summary
Step 3 is directionally correct, but I can’t approve it yet. The current Step 3 plan/check-off is missing key test coverage required by `PROMPT.md`, and the “full suite passing” claim is not currently reproducible from this worktree.

---

### What I reviewed
- `taskplane-tasks/TP-056-supervisor-merge-monitoring/PROMPT.md`
- `taskplane-tasks/TP-056-supervisor-merge-monitoring/STATUS.md`
- `extensions/tests/supervisor-merge-monitoring.test.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/supervisor.ts`

Validation commands run:
- `cd extensions && npx vitest run`
- `cd extensions && npx vitest run tests/supervisor-merge-monitoring.test.ts`
- `node bin/taskplane.mjs help`

---

### Findings

1. **[Blocking] Required Step 3 coverage is incomplete vs prompt requirements.**
   - Prompt explicitly requires:
     - event emission tests for each escalation tier,
     - early-exit signaling tests (`dead session → waitForMergeResult exits`)
     (`PROMPT.md:130-135`, completion criteria `PROMPT.md:157-160`).
   - Current test file mostly covers:
     - `classifyMergeHealth` pure classification,
     - supervisor formatting/notify,
     - source-string integration checks,
     - monitor start/stop/add/remove
     (`supervisor-merge-monitoring.test.ts:48-490`).
   - It does **not** exercise `MergeHealthMonitor.poll()` behavior to verify actual event emission + callback/early-exit signaling.

2. **[Blocking] “Full test suite passing” is currently not demonstrated.**
   - `STATUS.md` marks Step 3 complete and “Full test suite passing” (`STATUS.md:50-54`), but this is not reflected in execution log evidence.
   - Full run in this worktree produced a failure:
     - `tests/orch-direct-implementation.test.ts` timeout at 60s during `cd extensions && npx vitest run`.
   - Prompt requirement is explicit: **ZERO test failures allowed** (`PROMPT.md:128`, `136`).

3. **[Major] Early-exit behavior remains ambiguous in test plan and code path.**
   - Engine currently wires `onDeadSession` to logging only (`engine.ts:1367-1373`).
   - Monitor invokes callback on dead detection (`merge.ts:2539-2544`), but Step 3 tests do not verify a concrete contract for “signals early exit from waitForMergeResult” (`PROMPT.md:134`, `159`).
   - Plan should define a clear, assertable behavior for this requirement (not just source presence).

---

### Required updates before approval
1. **Hydrate Step 3 test plan** with concrete behavioral cases for `MergeHealthMonitor.poll()`:
   - warning/dead/stuck event emission paths,
   - per-session de-duplication (emit once per tier),
   - dead-session callback invocation semantics.
2. **Add explicit early-exit verification** case aligned with prompt criterion (`dead → waitForMergeResult exits early`).
3. **Re-run and record full-suite evidence** in STATUS execution log (command + result), and handle timeout/flaky failures explicitly before marking complete.
4. Keep CLI smoke evidence (`node bin/taskplane.mjs help`) logged alongside test evidence.

---

### Notes
- `node bin/taskplane.mjs help` passes.
- `tests/supervisor-merge-monitoring.test.ts` passes in isolation.
- Approval can proceed once missing behavioral coverage + full-suite gate evidence are added.