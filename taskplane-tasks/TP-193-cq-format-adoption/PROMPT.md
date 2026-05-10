# Task: TP-193 - Code-quality: enable Biome formatter and apply it once across the codebase

**Created:** 2026-05-10
**Size:** S (mechanically L by line count, conceptually S)

## Review Level: 0 (None)

**Assessment:** Pure mechanical pass — `biome format --write` applied once with the formatter rules locked in `biome.json`. Easier to spot-check than line-review. The diff is large (~50-80 files touched) but every change is whitespace, quote style, semicolon placement, or trailing-comma adjustment — no semantics. The test suite is the correctness gate. **Reviews skipped** because the diff is reviewer-hostile (every file changes; no signal in line-by-line) and the format rules themselves are reviewed at PROMPT-authoring time, not at PR time. Operator coordination on the freeze window (per spec section 6.3.4) is the actual gating concern, not code review.
**Score:** 1/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 0 (one-commit revert if needed)

## Canonical Task Folder

```
taskplane-tasks/TP-193-cq-format-adoption/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Third of four sequenced task packets implementing the code-quality-gates spec ([`docs/specifications/taskplane/code-quality-gates.md`](../../docs/specifications/taskplane/code-quality-gates.md), section 6.3). Enable the Biome formatter and apply it once across the entire codebase, with `.git-blame-ignore-revs` so future `git blame` doesn't bottom out on the format-adoption commit.

By the end of TP-193:
- `biome.json` has `formatter.enabled: true` with explicit rules locked.
- Every TS/MJS file in scope has been formatted (one mechanical commit).
- `.git-blame-ignore-revs` exists and lists the format-adoption commit's SHA.
- `docs/maintainers/development-setup.md` documents `git config blame.ignoreRevsFile .git-blame-ignore-revs` for new contributors.
- `npm run format:check` exits 0 on the resulting `main`.
- All existing tests still pass.

The diff will touch ~50-80 files. **This is expected.** Per spec section 6.3.4, the operator MUST coordinate a freeze window for in-flight PRs before this task runs, so they don't all need to rebase against a tangled diff.

## Dependencies

**None** — TP-191 + TP-192 must be merged first (this task assumes lint is clean and Biome is pinned), but no orchestrator-parsed dependency declared. Operator schedules sequentially.

Informational cross-references for context:
- TP-191 (must be merged first): introduces the formatter scripts and Biome config.
- TP-192 (must be merged first): clean lint baseline so the format pass doesn't tangle with lint cleanup.
- TP-194 (follows TP-193): the actual gate flip — depends on `format:check` being green on `main`.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/code-quality-gates.md` section 6.3 — operative for this task. Section 6.3.1 has the formatter rule choices.
- `biome.json` — current state (formatter disabled). Update per the spec.
- `docs/maintainers/development-setup.md` — current state. Add the `git blame` config note.

## Environment

- **Workspace:** repo root
- **Services required:** None

## File Scope

> File scope here is by-design large: most TS/MJS files in the lint scope
> will see whitespace/quote/semicolon adjustments. The orchestrator should
> NOT serialize against this with other tasks (don't run TP-193 in parallel
> with anything that touches the same files). Operator coordinates the
> freeze window externally.

- `biome.json` — enable formatter with explicit rules
- `.git-blame-ignore-revs` — NEW
- `extensions/**/*.ts` — formatted
- `bin/**/*.mjs` — formatted
- `scripts/**/*.mjs` — formatted
- `docs/maintainers/development-setup.md` — add git blame config note
- `CHANGELOG.md` — `[Unreleased]` entry under `Internal`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes.

### Step 0: Preflight

- [ ] On `main` (lane worktree, fresh from TP-191 + TP-192 merges)
- [ ] TP-191 + TP-192 confirmed merged (`npm run lint` exits 0; `npm run format:check` exits non-zero — formatter still disabled)
- [ ] **Operator confirmation captured in Discoveries**: freeze window has been announced and in-flight PRs are held. Without this, abort with a STATUS.md note rather than landing a 50+-file format diff that will conflict with everything in flight.
- [ ] Baseline test count recorded (target: 3624+ passing)

### Step 1: Configure formatter rules in biome.json

- [ ] Update `biome.json` `formatter` block per spec section 6.3.1:
  - `enabled: true`
  - `indentStyle: "tab"`
  - `indentWidth: 1`
  - `lineWidth: 100`
  - `lineEnding: "lf"`
- [ ] Update `javascript.formatter` block:
  - `quoteStyle: "double"`
  - `trailingCommas: "all"`
  - `semicolons: "always"`
  - `arrowParentheses: "always"`
- [ ] Verify rule choices match what the existing codebase already uses (tabs, double quotes, semicolons) so the diff is purely "add trailing commas and re-wrap long lines," not "change conventions."
- [ ] Run `npm run format:check` — should report many files needing formatting
- [ ] Commit: `chore(TP-193): configure Biome formatter rules`

### Step 2: Apply biome format --write across the codebase (single mechanical commit)

- [ ] Run `npm run format` (which runs `biome format --write .`)
- [ ] Inspect a sample of the diff: confirm only whitespace, quote, semicolon, and trailing-comma changes — NO logic changes
- [ ] Run full fast suite: `cd extensions && npm run test:fast` — 3624+ passing / 1 skipped / 0 failed
- [ ] Commit the format pass: `chore(TP-193): apply biome format --write to entire codebase (formatter adoption)`
- [ ] Capture the commit SHA for Step 3

### Step 3: Add .git-blame-ignore-revs

- [ ] Create `.git-blame-ignore-revs` with the Step 2 commit SHA + a comment explaining the file's purpose
- [ ] Commit: `chore(TP-193): add format-adoption commit to .git-blame-ignore-revs`
- [ ] Verify: `git blame --ignore-revs-file=.git-blame-ignore-revs <some-formatted-file>` skips the format-adoption commit
- [ ] Configure the local git: `git config blame.ignoreRevsFile .git-blame-ignore-revs` (this is one-time per developer; document in Step 4)

### Step 4: Documentation & Delivery

- [ ] Update `docs/maintainers/development-setup.md` to add a section on `.git-blame-ignore-revs`, explaining:
  - What the file is for
  - That `git config blame.ignoreRevsFile .git-blame-ignore-revs` is a one-time per-developer setup
  - That this is recommended (not required) — git blame still works without it; it just shows the format commit instead of the underlying author
- [ ] CHANGELOG entry under `[Unreleased]` → `Internal`:
  - Title: `**Code-quality formatter adoption (TP-193)**`
  - Body: 1-paragraph summary covering the formatter rules, the one-pass diff (file count), `.git-blame-ignore-revs`, and the `git config` note
- [ ] Discoveries logged in STATUS.md (file count touched by the format pass; rule choices applied; any rule conflicts with existing code)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] FULL fast suite passes: 3624+ passing / 1 skipped / 0 failed
- [ ] FULL integration suite passes
- [ ] `npm run format:check` exits 0
- [ ] `npm run lint` exits 0 (TP-192's cleanup must remain in effect — verify formatter didn't reintroduce lint errors)
- [ ] `npm run typecheck` exit status unchanged from TP-192's baseline
- [ ] CLI smoke clean: `node bin/taskplane.mjs help`, `node bin/taskplane.mjs doctor`

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Internal entry per Step 4
- `docs/maintainers/development-setup.md` — `.git-blame-ignore-revs` setup note

**Check If Affected:**
- `AGENTS.md` — if it references format conventions explicitly, update (but the formatter rules ARE the convention now; AGENTS.md may not need a change)

## Completion Criteria

- [ ] `npm run format:check` exits 0
- [ ] `.git-blame-ignore-revs` lists the format-adoption commit
- [ ] All tests passing (3624+)
- [ ] CHANGELOG entry added
- [ ] development-setup.md documents the git config

## Git Commit Convention

**Three commits expected (atomic, each scoped to one concern):**

1. `chore(TP-193): configure Biome formatter rules` — `biome.json` formatter block changes only
2. `chore(TP-193): apply biome format --write to entire codebase (formatter adoption)` — the actual format pass; this is the SHA that goes into `.git-blame-ignore-revs`
3. `chore(TP-193): add format-adoption commit to .git-blame-ignore-revs` — the new file + dev-setup.md update + CHANGELOG entry

## Do NOT

- **Don't run this task without operator freeze-window confirmation.** Abort in Step 0 if not captured. A 50+-file diff during active PR development will create cascading rebase pain.
- **Don't change formatter rules from what's specified in section 6.3.1** — those are locked at PROMPT-authoring time after spec review. Discrepancy means escalate, not improvise.
- **Don't combine the format-pass commit with anything else.** It must be a single mechanical commit so `.git-blame-ignore-revs` can target one SHA.
- **Don't fix lint errors** discovered during the format pass — escalate to a TP-192 follow-up. TP-192 should already be clean; if Biome's formatter introduces new lint errors, that's a Biome bug to investigate, not silently fix.
- **Don't change `continue-on-error: true` in CI** — gate flip is TP-194's scope.
- **Don't load docs not listed in "Context to Read First."**
- **Don't commit without the `TP-193` prefix.**

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
