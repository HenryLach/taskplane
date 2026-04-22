## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist is on the right track, but it is still too broad to guarantee the highest-risk outcomes introduced by the non-blocking refactor. As written, it can be marked complete without explicitly validating JSONL event persistence and without pinning the specific launch/resume regression paths fixed in Step 3. Tightening those test outcomes now will reduce the chance of reintroducing recently fixed operational bugs.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly cover the required on-disk event-log contract (`PROMPT.md:114`). A generic “Event emission tests” item (`STATUS.md:62`) may validate callback delivery but still miss `.pi/supervisor/events.jsonl` writes implemented in `extensions/taskplane/persistence.ts:1768-1781`. **Suggested fix:** add a dedicated Step 4 outcome asserting JSONL creation and expected lifecycle records (including terminal event types).
2. **[Severity: important]** — “Command compatibility tests” (`STATUS.md:64`) is too coarse to guarantee coverage of the exact race/early-return regressions fixed in Step 3. The non-blocking handoff and launching-state safeguards are in sensitive paths (`extensions/taskplane/extension.ts:705-735`, `:890-899`, `:1055-1060`, `:1151-1161`; `extensions/taskplane/resume.ts:769-799`, `:813-820`, `:941-950`). **Suggested fix:** add explicit outcomes for (a) immediate post-launch `/orch-status`/`/orch-pause`/`/orch-abort` behavior and (b) `/orch-resume` pre-execution early returns resetting phase out of `launching`.

### Missing Items
- Explicit Step 4 test outcome for `.pi/supervisor/events.jsonl` persistence (not just in-memory callback emission).
- Explicit Step 4 regression outcome for launch-window command behavior immediately after detached `/orch` start.
- Explicit Step 4 regression outcome for `/orch-resume` early-return paths that must not leave phase stuck at `launching`.

### Suggestions
- Use deterministic timer control (fake timers/next-tick flushing) for the “handler returns quickly” assertion so CI timing jitter does not cause flaky tests.
- Reuse existing persistence-style temp-dir patterns from `extensions/tests/tier0-watchdog.test.ts` or `extensions/tests/orch-state-persistence.test.ts` for JSONL assertions.
