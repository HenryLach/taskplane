# Task: TP-194 - Code-quality: flip the gates (typecheck + lint + format:check required) and activate reviewer downgrade rule

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** This is the gate flip — the moment static analysis becomes a real gate, not decoration. Touches CI workflow (remove `continue-on-error`, add typecheck + format:check jobs), branch protection (admin action — operator handles), reviewer agent prompt (remove temporary activation note from TP-191), AGENTS.md, release-process.md, development-setup.md. Plan review evaluates the ordering of CI changes and branch protection updates. Code review verifies the workflow YAML, the reviewer prompt is fully activated, and documentation is consistent. Per-step reviews fit naturally — workflow updates, reviewer activation, and docs are independent concerns.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2 (workflow change is reversible; documentation change is reversible)

## Canonical Task Folder

```
taskplane-tasks/TP-194-cq-gates-flip/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fourth and final task packet implementing the code-quality-gates spec ([`docs/specifications/taskplane/code-quality-gates.md`](../../docs/specifications/taskplane/code-quality-gates.md), section 6.4). Flip the gates from "advisory" to "required."

By the end of TP-194:
- `.github/workflows/ci.yml` runs `Typecheck`, `Lint (Biome)`, and `Format check (Biome)` as separate required steps. None has `continue-on-error: true`.
- Branch protection on `main` requires all three new status checks + the existing `Run tests`, `CLI smoke checks`, `Verify docs relative links` checks. (Branch protection settings are admin-only — see PROMPT section "Branch protection" below for the operator handoff.)
- `templates/agents/task-reviewer.md` no longer has the temporary "Issues Found but no REVISE downgrade" activation note from TP-191. The TP-188 quality-check verification section is fully active: any failing typecheck/lint/format:check downgrades APPROVE → REVISE.
- Documentation reflects the new gates:
  - `AGENTS.md` adds typecheck/lint/format:check to the validation checklist
  - `docs/maintainers/release-process.md` adds the three commands to the pre-release checklist
  - `docs/maintainers/development-setup.md` documents the gate commands for new contributors
- All existing tests still pass (no behavior change to runtime code).
- CHANGELOG entry under `[Unreleased]` → `Internal` describes the gate flip.

**Critical pre-condition:** TP-191, TP-192, and TP-193 must all be merged. After their merges, `npm run typecheck`, `npm run lint`, and `npm run format:check` must all exit 0 on a clean `main`. If any fail, this task aborts with a STATUS.md note to fix the precursor first.

## Dependencies

**None** — TP-191 + TP-192 + TP-193 must all be merged before TP-194 runs, but no orchestrator-parsed dependency declared. Operator schedules sequentially.

Informational cross-references for context:
- TP-191 (must be merged first): scripts + tooling + reviewer discoverability
- TP-192 (must be merged first): clean lint baseline
- TP-193 (must be merged first): formatter adoption
- Tier-1.5 follow-ups (post-TP-194): TS strictness ratchet, CHANGELOG fragment system. Not in this task's scope.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/code-quality-gates.md` section 6.4 — operative for this task. Sections 11 (validation summary) and 8 (risks) provide the success criteria.
- `.github/workflows/ci.yml` — current state; will be modified
- `templates/agents/task-reviewer.md` — current state including the TP-191 temporary activation note (to be removed)
- `AGENTS.md` — current validation checklist (to be augmented)
- `docs/maintainers/release-process.md` — current pre-release checklist (to be augmented)
- `docs/maintainers/development-setup.md` — current state; gate commands to be documented

## Environment

- **Workspace:** repo root (CI workflow + docs)
- **Services required:** GitHub admin access for branch protection settings (operator action — see PROMPT body)

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel.

- `.github/workflows/ci.yml` — remove `continue-on-error`, add typecheck + format:check jobs
- `templates/agents/task-reviewer.md` — remove temporary activation note
- `AGENTS.md` — augment validation checklist
- `docs/maintainers/release-process.md` — augment pre-release checklist
- `docs/maintainers/development-setup.md` — document gate commands
- `CHANGELOG.md` — `[Unreleased]` entry under `Internal`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] On `main` (lane worktree, fresh from TP-191 + TP-192 + TP-193 merges)
- [ ] TP-191, TP-192, TP-193 confirmed merged (verify via `git log --oneline main -20`)
- [ ] **Critical:** all three gates already pass on `main` BEFORE this task makes any changes:
  - [ ] `npm run typecheck` exits 0
  - [ ] `npm run lint` exits 0
  - [ ] `npm run format:check` exits 0
  - If ANY fails, STOP. Document in STATUS.md and escalate to operator. The fix belongs in a follow-up to whichever precursor task introduced the failure, not in TP-194.
- [ ] Baseline test count recorded (target: 3624+ passing)
- [ ] All Tier 3 context files read

### Step 1: Plan the gate flip

> ⚠️ Plan-review checkpoint. Reviewer evaluates the workflow structure and ordering.

- [ ] Part 1 design: CI workflow structure — three separate steps (`Typecheck`, `Lint (Biome)`, `Format check (Biome)`) so failure messages name which gate broke. Decision: separate steps vs single matrix vs consolidated job. **Spec leans separate steps for diagnostic clarity** — confirm or override.
- [ ] Part 2 design: order of operations within the workflow — `Typecheck` runs before `Lint` runs before `Format check` runs before `Run tests` (cheapest gates first; tests last as the most expensive)
- [ ] Part 3 design: reviewer activation — what exact prompt-text changes are needed to remove the TP-191 temporary note (capture the diff for code reviewer)
- [ ] Part 4 design: documentation updates — AGENTS.md, release-process.md, development-setup.md changes
- [ ] Part 5 design: branch protection — list the exact required status checks the operator will need to add via GitHub UI (this task does NOT make the branch protection change; it documents what the operator should add)
- [ ] Drafts in Discoveries

### Step 2: Implement Part 1 — CI workflow updates

> Plan-reviewer must have APPROVED Step 1 before proceeding.

- [ ] Update `.github/workflows/ci.yml`:
  - Add `Typecheck` step running `npm run typecheck` (no `continue-on-error`)
  - Modify existing `Lint (Biome)` step to remove `continue-on-error: true`
  - Add `Format check (Biome)` step running `npm run format:check` (no `continue-on-error`)
- [ ] Order: `Typecheck` → `Lint` → `Format check` → existing `Run tests`
- [ ] Verify YAML syntax: `gh workflow view ci.yml` or local YAML lint
- [ ] Validate the workflow structure doesn't break the existing `Run tests` step

### Step 3: Implement Part 2 — activate reviewer downgrade rule

> ⚠️ Code-review fires after this step.

- [ ] Remove the temporary activation note from `templates/agents/task-reviewer.md` that was added in TP-191. The TP-188 Quality-check verification section returns to its full as-shipped form.
- [ ] Confirm the section now reads as fully active: failing typecheck/lint/format:check downgrades APPROVE → REVISE.

### Step 4: Implement Parts 3-4 — documentation

> ⚠️ Code-review fires after this step.

- [ ] Update `AGENTS.md`: add `npm run typecheck`, `npm run lint`, `npm run format:check` to the validation checklist for any PR
- [ ] Update `docs/maintainers/release-process.md`: add the three commands to the pre-release validation checklist (in the section that currently lists `npm pack --dry-run` + tests + CLI smoke). The commands must run AND pass before tagging a release
- [ ] Update `docs/maintainers/development-setup.md`: add a new section documenting the three gate commands for new contributors. Reference the spec for the rationale

### Step 5: Branch protection (operator handoff)

> This step does NOT modify any code or settings. It documents what the operator
> needs to do via the GitHub repo settings UI after this task's PR merges.

- [ ] Document in STATUS.md Discoveries the exact required-status-check names the operator should add to `main` branch protection:
  - `Typecheck`
  - `Lint (Biome)`
  - `Format check (Biome)`
  - (existing) `Run tests`
  - (existing) `CLI smoke checks`
  - (existing) `Verify docs relative links`
- [ ] PR body and CHANGELOG entry both reference this operator handoff so it's not forgotten

### Step 6: Testing & Verification

> ZERO test failures allowed.

- [ ] FULL fast suite passes: `cd extensions && npm run test:fast` (target: 3624+ passing / 1 skipped / 0 failed)
- [ ] FULL integration suite passes
- [ ] `npm run typecheck` exits 0 (gate live)
- [ ] `npm run lint` exits 0 (gate live)
- [ ] `npm run format:check` exits 0 (gate live)
- [ ] CLI smoke clean
- [ ] Reviewer agent on a synthetic regression task (e.g., a planted typecheck error) downgrades APPROVE → REVISE — capture this verification in Discoveries (can be a manual smoke; doesn't need to be a new automated test)

### Step 7: Documentation & Delivery

- [ ] CHANGELOG entry under `[Unreleased]` → `Internal`:
  - Title: `**Code-quality gates active (TP-194)**`
  - Body: 2-paragraph summary covering: (1) the three new required CI gates and the gate flip from advisory to required; (2) the reviewer-agent downgrade rule activation; (3) the documentation updates; (4) the operator handoff for branch protection. Reference the spec.
- [ ] Discoveries logged in STATUS.md (the manual reviewer-agent smoke result; any deviations from the spec's planned approach)
- [ ] All commits include `TP-194` prefix
- [ ] Step boundaries committed cleanly

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — Internal entry per Step 7
- `AGENTS.md` — validation checklist
- `docs/maintainers/release-process.md` — pre-release checklist
- `docs/maintainers/development-setup.md` — new section on gate commands

**Check If Affected:**
- `.pi/agents/supervisor.md` — if it references gates or PR-time checks, update
- `templates/agents/task-worker.md` — if it references the reviewer's quality-check rule, ensure consistency

## Completion Criteria

- [ ] All three gates required in CI (`continue-on-error: true` removed)
- [ ] Reviewer agent's TP-188 downgrade rule fully active
- [ ] Documentation reflects the new gates
- [ ] Branch protection update documented for operator handoff
- [ ] All tests passing (3624+)
- [ ] Per-step plan + code reviews APPROVE'd
- [ ] CHANGELOG entry added

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-194): complete Step N — description`
- **Bug fixes:** `fix(TP-194): description`
- **Docs:** `docs(TP-194): description`

## Do NOT

- **Don't proceed if Step 0's pre-condition check fails.** If `npm run typecheck`/`lint`/`format:check` doesn't exit 0 on the fresh `main` BEFORE this task's changes, STOP. The fix belongs in a follow-up to TP-191/TP-192/TP-193, not in this task. This is the most important guardrail in the entire spec.
- **Don't change the branch protection settings via the GitHub API or CLI.** Branch protection is admin-only and the operator handles it via the UI after this PR merges. This task documents the handoff; it doesn't execute it.
- **Don't change the reviewer's TP-188 quality-check section beyond removing the temporary activation note.** The substantive logic (discovery loop, severity classification, downgrade rule) is the original TP-188 design and stays as-is.
- **Don't bundle the strictness ratchet or CHANGELOG fragments into this task** — those are Tier-1.5 follow-ups per spec section 9.
- **Don't load docs not listed in "Context to Read First."**
- **Don't commit without the `TP-194` prefix.**

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
