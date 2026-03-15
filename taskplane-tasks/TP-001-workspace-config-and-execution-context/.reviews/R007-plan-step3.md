# R007 — Plan Review (Step 3: Testing & Verification)

## Verdict
**Changes requested** — Step 3 is substantially improved and now hydrated, but it still misses critical verification requirements.

## Reviewed artifacts
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/PROMPT.md`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/extension.ts`
- `extensions/tests/*`

## What improved
- Step 3 is now broken into concrete sub-sections with actionable checkboxes (`STATUS.md:69-120`).
- You added explicit workspace config/error-code test coverage goals.
- You added CLI smoke verification (`help` + `doctor`).

## Blocking findings

### 1) Step 3 acceptance criteria conflict with PROMPT “ZERO test failures allowed”
- `PROMPT.md` Step 3 requires zero failures.
- Current plan allows “no new failures beyond pre-existing baseline” (`STATUS.md:113-116`).
- That is weaker than the task contract and creates ambiguity at completion.

**Why this blocks:** completion criteria become non-deterministic and can be interpreted as passing while the suite is still red.

### 2) Plan does not cover known high-severity regressions already identified in prior code reviews
Two previously identified defects are still not explicitly test-planned:

- `workspace.ts` repo-root validation gap: `--show-toplevel` failure path is currently accepted implicitly (`workspace.ts:237-248`).
- `workspace.ts` `routing.tasks_root` checks existence only, not directory-ness (`workspace.ts:287-296`).
- `extension.ts` stale `execCtx` risk on failed `session_start` (no explicit reset before build) (`extension.ts:628-651`).
- `extension.ts` startup guard inconsistency (`requireExecCtx` not applied to `/orch-status`, `/orch-pause`, `/orch-sessions`) (`extension.ts:307-350`, `618-623`).

Current Step 3 checkboxes do not assert regression tests for these exact behaviors.

**Why this blocks:** Step 3 can complete while known correctness issues remain untested and potentially unresolved.

### 3) Root-consistency verification is mostly manual inspection, not executable regression tests
- Section 3.5 is currently “verify file usage patterns” style (`STATUS.md:99-107`) rather than runnable assertions.
- For this task’s blast radius (runtime roots + startup context), these checks should be automated where possible.

**Why this blocks:** manual verification is easy to regress and hard to enforce in future changes.

## Required plan updates before execution
1. **Align pass criteria with prompt contract**:
   - Either plan to make `npx vitest run` fully green, **or** explicitly log a blocker and stop Step 3 as incomplete (do not mark pass on “no new failures”).
2. **Add explicit regression tests for outstanding high-severity findings**:
   - repo path that is not a working-tree root (including `--show-toplevel` failure path),
   - `routing.tasks_root` pointing to a file,
   - `session_start` failure clears/does not retain stale `execCtx`,
   - command guard behavior for `/orch-status`, `/orch-pause`, `/orch-sessions` under init failure.
3. **Convert 3.5 root checks into executable tests where feasible** (not only grep/manual review), especially for startup/guard behavior in `extension.ts`.
4. **Keep targeted test execution split by concern**:
   - workspace loader/context tests,
   - extension startup/command-guard tests,
   - then full-suite + CLI smoke.

## Non-blocking note
- Reviews table formatting/duplication in `STATUS.md` remains malformed; clean it when updating status next.
