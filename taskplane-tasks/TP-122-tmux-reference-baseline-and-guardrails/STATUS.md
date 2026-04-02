# TP-122: TMUX Reference Baseline and Guardrails — Status

**Current Step:** Step 1: Add audit script
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** S

---

### Step 0: Baseline inventory
**Status:** ✅ Complete
- [x] Record current TMUX reference counts by file for `extensions/taskplane/*.ts`
- [x] Classify references into buckets: compat-code, user-facing strings, comments/docs, types/contracts
- [x] Capture baseline in STATUS.md for future tasks

### Step 1: Add audit script
**Status:** 🟨 In Progress
- [ ] Create `scripts/tmux-reference-audit.mjs`
- [ ] Emit machine-readable summary (total + by-file + by-category)
- [ ] Support strict mode failure on functional TMUX usage

### Step 2: Add regression guard test
**Status:** ⬜ Not Started
- [ ] Add `extensions/tests/tmux-reference-guard.test.ts`
- [ ] Assert no functional TMUX command execution remains in `extensions/taskplane/*.ts`
- [ ] Assert audit script output stays parseable and deterministic

### Step 3: Tests and validation
**Status:** ⬜ Not Started
- [ ] Run targeted tests including new guard test
- [ ] Run full extension suite
- [ ] Fix failures

### Step 4: Documentation & delivery
**Status:** ⬜ Not Started
- [ ] Update migration doc with guardrail usage
- [ ] Update STATUS.md summary with baseline numbers and commands

---

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 20:19 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 20:19 | Step 0 started | Baseline inventory |
| 2026-04-02 20:27 | Step 0 completed | Baseline captured with per-file and per-bucket counts |
| 2026-04-02 20:27 | Step 1 started | Add audit script |
|-----------|--------|---------|

## Baseline Snapshot (2026-04-02)

Command used:

```bash
python - <<'PY'
import re,glob,os
base='extensions/taskplane'
pat=re.compile('tmux', re.I)
for path in sorted(glob.glob(base + '/*.ts')):
    text=open(path, encoding='utf-8').read()
    count=len(pat.findall(text))
    if count:
        print(os.path.basename(path), count)
PY
```

Reference count by file (`extensions/taskplane/*.ts`, case-insensitive `tmux` matches):

| File | TMUX refs |
|------|-----------:|
| abort.ts | 4 |
| agent-host.ts | 6 |
| config-loader.ts | 17 |
| config-schema.ts | 7 |
| diagnostics.ts | 3 |
| engine.ts | 3 |
| execution.ts | 26 |
| extension.ts | 5 |
| formatting.ts | 1 |
| lane-runner.ts | 3 |
| mailbox.ts | 2 |
| merge.ts | 9 |
| messages.ts | 2 |
| naming.ts | 1 |
| persistence.ts | 18 |
| process-registry.ts | 2 |
| resume.ts | 2 |
| sessions.ts | 4 |
| settings-tui.ts | 5 |
| supervisor.ts | 11 |
| task-executor-core.ts | 1 |
| types.ts | 44 |
| worktree.ts | 10 |
| **Total** | **186** |

Bucket classification (occurrence-level, same baseline scan):

| Bucket | Count | Notes |
|--------|------:|-------|
| compat-code | 28 | Legacy alias handling and compatibility branches (primarily `config-loader.ts`, `persistence.ts`) |
| user-facing strings | 28 | Operator text/hints/messages (`supervisor.ts`, `worktree.ts`, `extension.ts`, `formatting.ts`, `messages.ts`, `settings-tui.ts`) |
| comments/docs | 79 | Inline migration/remediation commentary and historical context comments |
| types/contracts | 51 | Type fields/unions/contracts and schema-level compatibility (`types.ts`, `config-schema.ts`) |
| **Total** | **186** | Matches baseline total |

Initial hotspot files by total refs: `types.ts` (44), `execution.ts` (26), `persistence.ts` (18), `config-loader.ts` (17), `supervisor.ts` (11).
