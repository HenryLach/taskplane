# TP-188: Reviewer quality checks + Windows worktree cleanup fallback — Status

**Current Step:** Step 5: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-07
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ Per TP-186's Order of Operations rule** (which should be live in the base
> worker prompt by the time this task runs): do NOT mark a step `Complete`
> until that step's code review has returned APPROVE.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main` (lane worktree); TP-186 confirmed merged (templates/agents/task-worker.md contains "Order of Operations", "death-spiral", "Recovery Recipe")
- [x] Baseline test count recorded — 3468 tests, 3467 pass, 1 skip, 0 fail (69 test files)
- [x] All Tier 3 context files read — task-reviewer.md, worktree.ts (removeWorktree + isRetriableRemoveError), types.ts (testing_commands), agent-bridge-extension.ts:439 (bash present in default reviewer tools)
- [x] Issues #541 and #543 read in full (described in PROMPT.md)
- [x] Decision recorded: hybrid — reviewer reads `.pi/taskplane-config.json` `taskRunner.testing.commands` first, falls back to inspecting `package.json` scripts for `typecheck`/`lint`/`format:check`. Documented in Discoveries.

---

### Step 1: Plan both sub-fixes
**Status:** ✅ Complete

> ⚠️ Plan-review checkpoint.

- [x] Sub-fix A: Quality-check section drafted for task-reviewer.md (see Discoveries: "Sub-fix A draft section")
- [x] Sub-fix B: Detection logic + retry command + path normalization designed (see Discoveries: "Sub-fix B detection condition" + "Existing retriable error helper")
- [x] Drafts in Discoveries

---

### Step 2: Implement sub-fix A — reviewer quality checks
**Status:** 🟨 In Progress

- [x] templates/agents/task-reviewer.md augmented with Quality-check verification (new section before Verdict Criteria; covers config discovery, package.json fallback, severity=important, REVISE downgrade)
- [x] Confirm reviewer's existing bash tool is sufficient (agent-bridge-extension.ts:492 default tools include `bash`; new section explicitly notes `bash` is already allowed)

---

### Step 3: Implement sub-fix B — Windows worktree fallback
**Status:** 🟨 In Progress

- [x] worktree.ts removeWorktree adds Windows + "Filename too long" detection (new `isWindowsMaxPathError` helper guards on `process.platform === "win32"`)
- [x] cmd /c "rd /s /q" fallback with backslash path normalization (new `runWindowsCmdRd` helper; `path.replace(/\//g, "\\")`); on success also runs `git worktree prune` so post-removal verification passes
- [x] INFO-level log of fallback attempt (`execLog("cleanup", "worktree", ...)` for detection, success, and failure)
- [x] Other error classes still surface unchanged (fallback only fires when `isWindowsMaxPathError(stderr)` is true; non-Windows or other errors flow through original retriable/terminal classification untouched)

---

### Step 4: Add tests
**Status:** 🟨 In Progress

- [x] reviewer-quality-checks.test.ts created (10 source-pattern tests on templates/agents/task-reviewer.md)
- [x] windows-worktree-cleanup-fallback.test.ts created (11 source-pattern + 3 isWindowsMaxPathError unit + 3 runWindowsCmdRd mock-based unit; platform-agnostic)
- [x] Targeted run passes (27/27 in 201ms)

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passing
- [ ] Integration suite passing
- [ ] CLI smoke clean
- [ ] Code-review checkpoint at Step 5
- [ ] Per TP-186's rule: don't mark Step 2/3/4 Complete until APPROVE

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG.md two Unreleased / Fixed entries (#541, #543)
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| 1 | plan | 1 | APPROVE | (in-process verdict) |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Decision: hybrid command discovery | Sub-fix A reviewer prompt | Reviewer first checks `.pi/taskplane-config.json` `taskRunner.testing.commands`. If absent, inspects `package.json`'s `scripts` for `typecheck`/`lint`/`format:check` and runs those. Skips silently if neither source yields anything. |
| Sub-fix A draft section | templates/agents/task-reviewer.md | New "Quality-check verification (code reviews only)" section between "How You Work" and "Verdict Criteria". Reviewer runs typecheck/lint/format before deciding. Failures = Issues Found with severity `important`. Verdict downgrades behavioural APPROVE → REVISE. Plan reviews skip this entirely. |
| Sub-fix B detection condition | extensions/taskplane/worktree.ts removeWorktree | After failed `runGit(["worktree", "remove", "--force", path])`: if `process.platform === 'win32'` AND `/Filename too long/i`.test(stderr), call `cmd /c "rd /s /q <BACKSLASH-PATH>"` via `execFileSync("cmd", ["/c", "rd /s /q \"" + winPath + "\""])`. Log INFO via `execLog("cleanup", "worktree", ...)`. On success, treat as removed and proceed to verification. On failure, surface original git stderr unchanged. |
| Existing retriable error helper | worktree.ts:625 | `isRetriableRemoveError` does NOT match "Filename too long" (it's not in the list). Good — fallback path is independent of retry path. Will run only after retries exhaust OR if classified non-retriable; safer to also try BEFORE the throw if first attempt sees the pattern. Plan: detect on first occurrence of the stderr pattern, attempt fallback, succeed → proceed; else continue normal retry/throw flow. |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-07 02:02 | Task started | Runtime V2 lane-runner execution |
| 2026-05-07 02:02 | Step 0 started | Preflight |

---

## Blockers

*None — but ideally TP-186 ships first.*

---

## Notes

- Bundles two independent issues from the same postmortem dump. Combined
  size is S; each sub-fix touches a different file with no overlap, so
  parallel implementation within the task is fine.
- The Windows fallback specifically benefits this user (Windows + emailgistics-astro
  with 700+ npm deps). Likely to fire on most batches once shipped.
| 2026-05-07 02:06 | Review R001 | plan Step 1: APPROVE |
