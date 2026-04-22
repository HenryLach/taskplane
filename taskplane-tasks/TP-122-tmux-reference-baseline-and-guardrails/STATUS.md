# TP-122: TMUX Reference Baseline and Guardrails — Status

**Current Step:** Step 4: Documentation & delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 7
**Iteration:** 1
**Size:** S

---

### Step 0: Baseline inventory
**Status:** ✅ Complete
- [x] Record current TMUX reference counts by file for `extensions/taskplane/*.ts`
- [x] Classify references into buckets: compat-code, user-facing strings, comments/docs, types/contracts
- [x] Capture baseline in STATUS.md for future tasks

### Step 1: Add audit script
**Status:** ✅ Complete
- [x] Define strict-mode functional TMUX detection scope and explicit exclusions
- [x] Define deterministic JSON output contract (schema + stable ordering + normalized paths)
- [x] Create `scripts/tmux-reference-audit.mjs`
- [x] Emit machine-readable summary (total + by-file + by-category)
- [x] Support strict mode failure on functional TMUX usage with explicit exit-code + diagnostics contract
- [x] Fix Windows path normalization so output paths are always POSIX-style

### Step 2: Add regression guard test
**Status:** ✅ Complete
- [x] Add `extensions/tests/tmux-reference-guard.test.ts`
- [x] Assert no functional TMUX command execution remains in `extensions/taskplane/*.ts`
- [x] Assert audit script output stays parseable and deterministic

### Step 3: Tests and validation
**Status:** ✅ Complete
- [x] Run targeted tests including new guard test
- [x] Run full extension suite
- [x] Fix failures

### Step 4: Documentation & delivery
**Status:** ✅ Complete
- [x] Update migration doc with guardrail usage
- [x] Update STATUS.md summary with baseline numbers and commands

---

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 20:19 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 20:19 | Step 0 started | Baseline inventory |
| 2026-04-02 20:27 | Step 0 completed | Baseline captured with per-file and per-bucket counts |
| 2026-04-02 20:27 | Step 1 started | Add audit script |
| 2026-04-02 20:28 | Review R001 (plan, step 1) | REVISE — add strict-mode boundary + deterministic output contract items |
| 2026-04-02 20:29 | Review R002 (plan, step 1) | APPROVE |
| 2026-04-02 20:37 | Step 1 completed | Added deterministic audit script with `--json` and `--strict` |
| 2026-04-02 20:38 | Review R003 (code, step 1) | REVISE — normalize output paths to POSIX separators on Windows |
| 2026-04-02 20:40 | Step 1 revision applied | POSIX path normalization fixed in audit output |
| 2026-04-02 20:40 | Step 1 completed (post-review) | Ready for re-review |
| 2026-04-02 20:41 | Review R004 (code, step 1) | APPROVE |
| 2026-04-02 20:41 | Review R005 (plan, step 2) | APPROVE |
| 2026-04-02 20:40 | Step 2 started | Add regression guard test |
| 2026-04-02 20:45 | Step 2 completed | Added guard test for strict/no-functional-TMUX + deterministic JSON |
| 2026-04-02 20:46 | Review R006 (code, step 2) | APPROVE |
| 2026-04-02 20:46 | Review R007 (plan, step 3) | APPROVE |
| 2026-04-02 20:45 | Step 3 started | Tests and validation |
| 2026-04-02 20:48 | Step 3 tests | Targeted guard test: pass (2/2) |
| 2026-04-02 20:50 | Step 3 tests | Full suite: pass (3390/3390) |
| 2026-04-02 20:50 | Step 3 completed | No failures required fixes |
| 2026-04-02 20:50 | Step 4 started | Documentation & delivery |
| 2026-04-02 20:53 | Step 4 completed | Migration doc + STATUS delivery summary updated |
| 2026-04-02 20:37 | Agent reply | TP-122 complete. STATUS.md marked ✅ Complete, .DONE created, and all step commits are in place. Implemented scripts/tmux-reference-audit.mjs + extensions/tests/tmux-reference-guard.test.ts, updated mi |
| 2026-04-02 20:37 | Worker iter 1 | done in 1056s, tools: 110 |
| 2026-04-02 20:37 | Task complete | .DONE created |
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

## Step 1 Plan Contracts (R001)

### Strict-mode functional TMUX detection
- Included: executable TMUX command usage in non-comment code lines where TMUX appears in process-exec patterns (`spawn*`, `exec*`, `execFile*`, `execa*`) either as the executable (`"tmux"`) or in an executed shell payload.
- Excluded: comments/docs, user-facing copy (`"tmux attach ..."`), and compatibility metadata/identifiers (`tmuxPrefix`, `tmuxSessionName`, type unions, legacy aliases).
- Failure contract: `--strict` exits with code `2` when functional usages are detected and includes deterministic `functionalUsage.matches[]` diagnostics in JSON output.

### Deterministic JSON contract
- Schema root fields: `schemaVersion`, `scope`, `contracts`, `totals`, `byCategory`, `byFile`, `functionalUsage`.
- Stable ordering: files sorted lexicographically by normalized path; category keys emitted in fixed order (`compat-code`, `user-facing strings`, `comments/docs`, `types/contracts`); functional matches sorted by file/line/column.
- Path normalization: repo-relative POSIX-style paths (e.g., `extensions/taskplane/execution.ts`).

## Notes

- Reviewer suggestion (R001): keep explicit CLI flags (`--strict`, `--json`) so Step 2 tests can target a stable interface.
- Reviewer suggestion (R001): add a known-good audit JSON example in STATUS.md once Step 1 implementation is complete.
- Reviewer suggestion (R003): remove the unused `basename` import from `tmux-reference-audit.mjs` while touching the file.

## Delivery Summary (TP-122)

### Guardrail commands

```bash
# Baseline / report
node scripts/tmux-reference-audit.mjs --json

# Enforcement (fails with exit code 2 on functional TMUX command usage)
node scripts/tmux-reference-audit.mjs --json --strict

# Regression test
cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/tmux-reference-guard.test.ts
```

### Known-good baseline snapshot (from `--json`)

- `totals.references`: **186**
- `totals.filesScanned`: **36**
- `totals.filesWithReferences`: **23**
- `functionalUsage.count`: **0**
- `byCategory`: `{"compat-code": 28, "user-facing strings": 25, "comments/docs": 82, "types/contracts": 51}`
