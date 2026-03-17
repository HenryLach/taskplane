## Code Review: Step 1: Design Settings Navigation

### Verdict: REVISE

### Summary
The Step 1 design is much more complete and now covers field contracts, layer ownership, and discoverability of JSON-only fields. However, the artifact still contains contradictory canonical statements that would cause implementation drift in Step 2. These need to be resolved in `STATUS.md` before treating Step 1 as complete.

### Issues Found
1. **[taskplane-tasks/TP-018-settings-tui-command/STATUS.md:31-38] [important]** — Step 1 is marked `✅ Complete`, but the Step 1 checklist still has unresolved R004 items (`[ ]` on lines 37-38). This creates state inconsistency for orchestration/review gating. **Fix:** either complete those items now or set Step 1 status back to in-progress until they are closed.
2. **[taskplane-tasks/TP-018-settings-tui-command/STATUS.md:276-290,323-324] [important]** — Navigation spec is still internally inconsistent: the canonical table defines **12** sections (including `Advanced (JSON Only)`), while the design decision text says top-level SelectList has **11** items. **Fix:** keep one canonical count/order and update all references to match.
3. **[taskplane-tasks/TP-018-settings-tui-command/STATUS.md:346-347] [important]** — Source-badge rule still says user source applies when preference is “set (non-undefined)”, which conflicts with runtime merge behavior for string prefs where empty string is treated as not set (`extensions/taskplane/config-loader.ts:491-507`). **Fix:** align the generic rule with merge semantics (strings must be non-empty; enum/number fields use defined valid values).
4. **[taskplane-tasks/TP-018-settings-tui-command/STATUS.md:257,264] [important]** — Worker `spawnMode` option mapping is contradictory: one list says worker uses `["tmux", "subprocess"]`, another says worker uses `["(inherit)", "subprocess", "tmux"]`. **Fix:** define one canonical options list for worker spawn mode and remove the conflicting entry.

### Pattern Violations
- Conflicting “source of truth” statements within the same design artifact (section count and source semantics).

### Test Gaps
- No explicit Step 2 test intent for section render count/order to prevent 11-vs-12 regressions.
- No explicit Step 2 test intent for empty-string string preferences (`""`) reverting source/value to project/default.
- No explicit Step 2 test intent for `taskRunner.worker.spawnMode` `(inherit)` write-back behavior (key deletion + source badge).

### Suggestions
- Add a short **Canonical Navigation Map** and **Canonical Source Rule Matrix** block near the top of Step 1, then reference those blocks elsewhere instead of re-stating rules.
