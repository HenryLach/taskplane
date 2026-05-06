# Task: TP-188 - Reviewer runs typecheck/lint + Windows worktree cleanup fallback

**Created:** 2026-05-06
**Size:** S

## Review Level: 2 (Plan and Code)

**Assessment:** Two small independent fixes bundled because they're both narrow in scope and ready to ship together. Sub-fix A (reviewer quality checks) is a templates/agents/task-reviewer.md augmentation — low blast radius but affects every code review going forward, so plan review catches wording issues. Sub-fix B (Windows worktree cleanup fallback) is a localized addition to a single function in worktree.ts — engine-level but a clean fallback path, no behavioral change for non-Windows or for cases where the existing `git worktree remove` succeeds. Code review on B is essential (must not mask other classes of error as "filename too long").
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-188-reviewer-quality-checks-and-windows-cleanup/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Two independent fixes, bundled because each is small enough to not warrant a separate task:

### Sub-fix A: Code reviewer should run typecheck/lint/format checks ([#541](https://github.com/HenryLach/taskplane/issues/541))

The reviewer agent (spawned via `review_step`) currently evaluates code changes through behavioural inspection only. It does NOT run the project's declared typecheck / lint / format checks as part of its review. As a result, code with TypeScript strict-mode errors, lint failures, or format violations can receive a code-review APPROVE — these issues then surface at the task's final Testing & Verification step, blocking the entire batch. In production batch `20260506T105850`, R003-code-step1 returned APPROVE for code that subsequently failed `npm run typecheck` with 5 strict-mode errors — all in test code touching the new module that R003 had reviewed. Cost of catching these earlier: one extra `npm run typecheck` per code review. Cost of NOT catching them: entire investment in the affected step plus all dependents.

The reviewer's existing tool allowlist already includes `bash` (per `agent-bridge-extension.ts:439`), so it can already invoke `npm run typecheck` etc. It just doesn't, by prompt design.

### Sub-fix B: Windows MAX_PATH error blocks `git worktree remove` ([#543](https://github.com/HenryLach/taskplane/issues/543))

On Windows with default `core.longpaths = false`, `git worktree remove --force` fails with `error: failed to delete '<path>': Filename too long` when the worktree contains a deep `node_modules` tree (most non-trivial Node projects). The orch reports cleanup-incomplete via the post-integration banner but doesn't recover. The supervisor must manually run `cmd /c "rd /s /q <path>"` which uses a different deletion code path that handles long paths better. Affects every Windows operator on every batch with a substantial `node_modules`. Hits this user (Windows) on emailgistics-astro (700+ npm deps) — observed twice during a single recovery flow.

## Dependencies

- **Soft dependency on TP-186** — both sub-fixes are safer to run when the worker isn't vulnerable to the death-spiral. Either order works; recommended order is TP-186 first.

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- Issue #541 body — concrete repro evidence (R003 APPROVE + 5 typecheck errors), fix proposals A/B/C
- Issue #543 body — concrete repro from production, fix proposals A (engine fallback) + B (docs)
- `templates/agents/task-reviewer.md` — current reviewer prompt structure (Verdict / Summary / Issues Found / Pattern Violations / Test Gaps / Suggestions). New "Quality-check verification" section fits between existing sections.
- `extensions/taskplane/agent-bridge-extension.ts:439` — reviewer's hardcoded tool allowlist `read,bash,grep,find,ls`. Confirm `bash` is present (it is) so the reviewer can already run `npm run typecheck` etc. without further allowlist changes.
- `extensions/taskplane/worktree.ts` — the `removeWorktree` function (or wherever `git worktree remove` is invoked). The Windows fallback adds detection of "Filename too long" stderr and retries via `cmd /c "rd /s /q <path>"`.
- `extensions/taskplane/types.ts` — `taskRunner.testing.commands` config field. Used by sub-fix A for project-configured quality-check commands.
- `extensions/tests/lifecycle/` (any worktree test files) — model for tests of the Windows fallback.

## Environment

- **Workspace:** `templates/agents/` + `extensions/taskplane/` + `extensions/tests/`
- **Services required:** None

## File Scope

### Sub-fix A (reviewer quality checks)
- `templates/agents/task-reviewer.md` — add a new "Quality-check verification" section before "Verdict". Reviewer runs the project's declared typecheck/lint/format commands before returning a verdict. Failures are surfaced as Issues Found with severity `important`. A behavioural-correctness APPROVE is invalidated by failing quality checks → return REVISE.
- (Optional) Read `taskRunner.testing.commands` from project config to determine which commands to run. If unset, fall back to a sensible default chain (`npm run typecheck`, `npm run lint`, `npm run format:check` — but only run each if the script exists per `package.json`'s `scripts`).
- `extensions/tests/reviewer-quality-checks.test.ts` (NEW) — source-pattern test that the reviewer prompt now contains the quality-check verification section + key keywords (`typecheck`, `lint`, `important`, `REVISE`).

### Sub-fix B (Windows worktree fallback)
- `extensions/taskplane/worktree.ts` — in the `removeWorktree` function (or equivalent), detect `process.platform === 'win32'` AND stderr matching `/Filename too long/i` after a failed `git worktree remove`. On match, retry via `execCheck("cmd /c \"rd /s /q \"" + path.replace(/\//g, '\\') + "\"\"")`. Log the fallback attempt at INFO level.
- `extensions/tests/windows-worktree-cleanup-fallback.test.ts` (NEW) — mock the failed `git worktree remove` stderr, assert the fallback `cmd rd` is invoked. Skip the test gracefully on non-Windows (or use mocks throughout to make it platform-agnostic).

### Documentation
- `CHANGELOG.md` — two Unreleased / Fixed entries (one per sub-fix)

## Steps

> **Hydration:** STATUS.md tracks outcomes. Workers expand steps when runtime
> discoveries warrant it.
>
> **⚠️ Per TP-186's Order of Operations rule:** do NOT mark a step `Complete`
> until that step's code review has returned APPROVE.

### Step 0: Preflight

- [ ] On `main` (lane worktree); TP-186 confirmed merged (grep `templates/agents/task-worker.md` for "Order of operations")
- [ ] Baseline test count recorded
- [ ] All Tier 3 context files read
- [ ] Issues #541 and #543 read in full
- [ ] Decision recorded: include the per-project `taskRunner.testing.commands` reading (sub-fix A's "B" option), or hardcode the default chain. Recommended: read from config when present, fall back to defaults when absent.

### Step 1: Plan both sub-fixes

> ⚠️ Plan-review checkpoint. Reviewer evaluates the prompt-augmentation
> wording AND the Windows fallback decision logic.

- [ ] Sub-fix A: draft the "Quality-check verification" section for `task-reviewer.md`. Specify behavior on failure (REVISE), severity of surfaced findings (important), and whether to read commands from `taskRunner.testing.commands` or use defaults.
- [ ] Sub-fix B: design the fallback's detection condition (platform + stderr regex) and the retry command. Determine path-separator normalization (forward slashes from Node need to become backslashes for `cmd rd`).
- [ ] Drafts in STATUS Discoveries

### Step 2: Implement sub-fix A — reviewer quality checks

- [ ] Augment `templates/agents/task-reviewer.md` with the Quality-check verification section
- [ ] If reading from `taskRunner.testing.commands`: confirm the reviewer's runtime context already has access to project config (it should — reviewers spawn from the same worktree as the worker)
- [ ] Verify the reviewer's existing bash tool is sufficient (it is — `agent-bridge-extension.ts:439` lists `read,bash,grep,find,ls`); no allowlist change needed

**Artifacts:**
- `templates/agents/task-reviewer.md` (modified)

### Step 3: Implement sub-fix B — Windows worktree fallback

- [ ] In `extensions/taskplane/worktree.ts`, add the Windows + "Filename too long" detection and `cmd rd /s /q` fallback after a failed `git worktree remove`
- [ ] Path normalization: replace forward slashes with backslashes in the path passed to `cmd rd` (Windows native path separator)
- [ ] Log the fallback attempt at INFO level so the operator sees what happened
- [ ] Confirm: do NOT swallow other classes of error. Only Windows + "Filename too long" triggers the fallback. Other failures should still surface their original error.

**Artifacts:**
- `extensions/taskplane/worktree.ts` (modified)

### Step 4: Add tests

- [ ] Create `extensions/tests/reviewer-quality-checks.test.ts` (sub-fix A)
- [ ] Create `extensions/tests/windows-worktree-cleanup-fallback.test.ts` (sub-fix B)
- [ ] Sub-fix B test should be platform-agnostic via mocking (don't require running on Windows to validate)
- [ ] Run targeted: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/reviewer-quality-checks.test.ts tests/windows-worktree-cleanup-fallback.test.ts`

**Artifacts:**
- `extensions/tests/reviewer-quality-checks.test.ts` (new)
- `extensions/tests/windows-worktree-cleanup-fallback.test.ts` (new)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Run FULL fast suite: `cd extensions && npm run test:fast`
- [ ] Run integration suite
- [ ] CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`
- [ ] **Code review checkpoint**: `review_step(step=5, type='code', baseline=<sha-before-step-2>)`
- [ ] Per TP-186's rule: do NOT mark Step 2 / 3 / 4 Complete until code review APPROVE

### Step 6: Documentation & Delivery

- [ ] Update `CHANGELOG.md` Unreleased / Fixed with two entries (one per sub-fix), crediting #541 and #543
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — two entries
- `templates/agents/task-reviewer.md` — primary deliverable for sub-fix A

**Check If Affected:**
- `docs/explanation/architecture.md` — review-flow description; verify nothing contradicts the new quality-check step
- `docs/reference/configuration/taskplane-settings.md` — if `taskRunner.testing.commands` is read by the reviewer, document that it's now consumed in code reviews too
- Any Windows-setup docs (currently not present, per the screenshot in #543) — could add a brief note about long-path support as defense-in-depth, but the engine fallback should make it unnecessary

## Completion Criteria

- [ ] Reviewer prompt includes Quality-check verification section
- [ ] Reviewer correctly returns REVISE when project quality checks fail (verified via the new test)
- [ ] Windows worktree cleanup falls back to `cmd rd /s /q` when `git worktree remove` fails with "Filename too long"
- [ ] Fallback does NOT trigger for other error classes
- [ ] All new tests pass
- [ ] Full test suite passing
- [ ] CHANGELOG entries added crediting #541 and #543

## Git Commit Convention

- **Step completion:** `fix(TP-188): complete Step N — description`
- **Tests:** `test(TP-188): add reviewer-quality-checks + windows-cleanup tests`
- **Docs:** `docs(TP-188): CHANGELOG entries for #541 #543`
- **Hydration:** `hydrate: TP-188 expand Step N checkboxes`

## Do NOT

- **Do not** change the reviewer's tool allowlist — `bash` is already present and sufficient
- **Do not** make the Windows fallback fire on non-Windows — guard with `process.platform === 'win32'`
- **Do not** swallow other classes of `git worktree remove` failure — only the specific MAX_PATH error pattern triggers the fallback
- **Do not** add long-path enablement instructions to setup docs as a "fix" — the engine fallback is the fix; docs would only be a defense-in-depth note
- **Do not** widen scope to address other issues from the same dump (#537, #538, #539, #540, #542) — those are TP-186 and TP-187 separately
- **Do not** push directly to `main` — branch + PR per AGENTS.md branching policy

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
