# Task: TP-191 - Code-quality prep: scripts, tool pinning, pi-shims, reviewer discoverability

**Created:** 2026-05-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Foundational tooling change. Touches build config (package.json), TypeScript config (new tsconfig.ci.json + types/pi-shims.d.ts), Biome config (modernize, expand scope), CI workflow (use pinned scripts), reviewer agent prompt (activation note), and project config (`.pi/taskplane-config.json`). No production code paths, but mistakes here cascade into TP-192 / TP-193 / TP-194. Plan review catches design decisions (shim strategy, scope boundaries); code review catches the actual wiring. Per-step reviews fit naturally — discovery, scripts+pinning, shims+tsconfig, biome modernization, reviewer config, and the validation step are independent concerns.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2 (config changes; one-step revert if needed)

## Canonical Task Folder

```
taskplane-tasks/TP-191-cq-prep-scripts-shims-tooling/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

First of four sequenced task packets implementing the code-quality-gates spec ([`docs/specifications/taskplane/code-quality-gates.md`](../../docs/specifications/taskplane/code-quality-gates.md)). This task is **prep only** — no gating changes, no behavior changes. Purpose is to add the foundational pieces (scripts, version pins, type shims, reviewer-discoverable commands) so subsequent task packets (TP-192 lint cleanup, TP-193 format adoption, TP-194 gate flip) can land safely.

The spec is the source of truth. **Read section 6.1 of the spec in full before planning.** This PROMPT scopes the work but does not duplicate the spec's design rationale.

By the end of TP-191:
- `npm run typecheck`, `npm run lint`, `npm run format`, `npm run format:check` all exist and execute (typecheck and lint will exit non-zero — that's expected; cleanup is TP-192 and TP-194's job).
- Biome and TypeScript are pinned in `devDependencies`.
- `extensions/types/pi-shims.d.ts` declares minimal type stubs for both `@earendil-works/*` AND `@mariozechner/*` Pi packages so headless `tsc --noEmit` resolves them.
- `extensions/tsconfig.ci.json` exists and includes all extension entry points + tests + the new shims directory.
- `biome.json` is modernized: `experimentalScannerIgnores` migrated to `ignore`, `$schema` URL updated to match the pinned Biome version, scope expanded to include `bin/**/*.mjs` and `scripts/**/*.mjs` and `extensions/tests/**`, dashboard public JS explicitly excluded.
- `.pi/taskplane-config.json` `taskRunner.testing.commands` adds `typecheck`, `lint`, and `format:check` so the TP-188 reviewer-agent quality-check discovery loop finds them.
- `templates/agents/task-reviewer.md` carries a **temporary** activation note explaining that lint/typecheck failures surface as Issues Found but do NOT downgrade APPROVE to REVISE until TP-194 lands. (The note is removed in TP-194.)
- All existing tests still pass (no behavior change).

## Dependencies

**None** — this is the first packet in the code-quality-gates sequence. TP-192, TP-193, TP-194 depend on this.

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/code-quality-gates.md` — **REQUIRED.** Section 6.1 is the operative spec for this task. Sections 1, 2, 3, 4, 7 (decisions), and 8 (risks) provide the rationale and constraints.
- `extensions/tsconfig.json` — current state to be preserved (this task does NOT modify the editor-facing config; it creates a SEPARATE `tsconfig.ci.json`)
- `extensions/tsconfig.test.json` — current state; this task DOES update it to add `@earendil-works/*` path mappings alongside existing `@mariozechner/*` ones
- `extensions/tests/mocks/pi-coding-agent.ts` — existing mock; the seed for shim shapes (do NOT just point shims to the mock; declare types in the .d.ts; see spec section 7.1)
- `extensions/tests/mocks/pi-tui.ts` — existing mock; same role
- `biome.json` — current config to be modernized
- `.github/workflows/ci.yml` lint step — will use `npm run lint` after this task
- `.pi/taskplane-config.json` — `testing.commands` block to be expanded
- `templates/agents/task-reviewer.md` — TP-188 quality-check section (currently dormant); add temporary activation note
- `package.json` — currently has NO `scripts` block; this task adds one

## Environment

- **Workspace:** repo root (mostly), plus `extensions/`
- **Services required:** None

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel. List the files and
> directories this task will create or modify. Use wildcards for directories.

- `package.json` — add `scripts` and `devDependencies`
- `package-lock.json` — regenerated by npm
- `extensions/types/pi-shims.d.ts` — NEW
- `extensions/tsconfig.ci.json` — NEW
- `extensions/tsconfig.test.json` — modify (add `@earendil-works/*` mappings; keep `@mariozechner/*` for back-compat)
- `biome.json` — modernize
- `.github/workflows/ci.yml` — update lint step to use `npm run lint` (still `continue-on-error: true` until TP-194)
- `.pi/taskplane-config.json` — add typecheck/lint/format:check to `testing.commands`
- `templates/agents/task-reviewer.md` — add temporary activation note
- `CHANGELOG.md` — `[Unreleased]` entry under `Internal`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] On `main` (lane worktree)
- [ ] Spec read in full: `docs/specifications/taskplane/code-quality-gates.md` (section 6.1 most important)
- [ ] Tier 3 context files read per scope
- [ ] Baseline test count recorded (target: 3624 passing / 1 skipped / 0 failed post-TP-190)
- [ ] Decision recorded: shim source strategy (per spec section 7.1, the lean is **hand-written minimal stubs**, seeded from `tests/mocks/pi-*.ts` shapes; refine on first tsc failure)
- [ ] Pinned versions confirmed available on npm: `@biomejs/biome@2.4.15`, `typescript@5.6.3` (verify via `npm view @biomejs/biome dist-tags` and `npm view typescript dist-tags` — if newer stable exists at task-execution time, use the latest stable in the same minor line and document the choice)

### Step 1: Plan all six implementation parts

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural choices.

- [ ] Part 1 design: scripts in `package.json` — names match what TP-188 reviewer agent looks for (`typecheck`, `lint`, `format`, `format:check`); commands invoke pinned tools via `npx --no` or via the local `node_modules/.bin/`
- [ ] Part 2 design: pi-shims structure — what minimum surface satisfies `tsc --noEmit` against the actual taskplane source? List the exports actually consumed (e.g., `ExtensionAPI`, `ExtensionContext`, `Type`, `truncateToWidth`, `DynamicBorder`, `getSettingsListTheme`, `Container`, `SelectList`, etc. — grep `extensions/` for the imports first)
- [ ] Part 3 design: `tsconfig.ci.json` — extends `tsconfig.json`, adds `paths` for both pi scopes pointing to the shims, includes all entry points + tests + types directory
- [ ] Part 4 design: `biome.json` migration — `experimentalScannerIgnores` to `ignore`, scope expansion, `$schema` URL update, formatter still disabled
- [ ] Part 5 design: `.pi/taskplane-config.json` and `templates/agents/task-reviewer.md` — discoverability + temporary activation note wording
- [ ] Part 6 design: `.github/workflows/ci.yml` lint step using `npm run lint` (still `continue-on-error: true`)
- [ ] Drafts in Discoveries section of STATUS.md

### Step 2: Implement Part 1 — `package.json` scripts and pinned dev deps

> Plan-reviewer must have APPROVED Step 1 before proceeding.

- [ ] Add `scripts` block per spec section 6.1.1
- [ ] Add `devDependencies` with pinned `@biomejs/biome` and `typescript`
- [ ] Run `npm install` to populate `node_modules` and refresh `package-lock.json`
- [ ] Verify scripts execute (will exit non-zero for typecheck/lint at this stage; that's expected): `npm run typecheck`, `npm run lint`, `npm run format:check` all RUN to completion
- [ ] Targeted test pass: full fast suite still passes

### Step 3: Implement Part 2 — pi-shims and tsconfig.ci.json

- [ ] Create `extensions/types/pi-shims.d.ts` with `declare module` blocks for both Pi scopes, declaring minimum surface used by taskplane source
- [ ] Create `extensions/tsconfig.ci.json` extending `tsconfig.json` with paths pointing to shims and full `include` covering all entry points + tests + types
- [ ] Update `extensions/tsconfig.test.json` to add `@earendil-works/*` path mappings alongside existing `@mariozechner/*` ones (back-compat preserved)
- [ ] Run `npm run typecheck` — should produce errors, but errors should be about TYPE issues (`error TSxxxx`), NOT module-resolution failures (`Cannot find module`). If module-resolution errors persist, extend the shim
- [ ] Capture the pre-cleanup typecheck error count for TP-194's gating decision (record in STATUS.md Discoveries)

### Step 4: Implement Part 3 — Biome config modernization

- [ ] Update `biome.json` per spec section 6.1.5: migrate `experimentalScannerIgnores` to `ignore`, update `$schema` URL to match pinned Biome 2.4.15, expand `includes` to cover `bin/**/*.mjs` and `scripts/**/*.mjs`, explicitly exclude `dashboard/public/**`, `extensions/types/**`, `.pi/**`, `.worktrees/**`
- [ ] Tests now INCLUDED in scope (sage's recommendation per spec section 7.2). If lint reveals high noise from test files, add per-rule overrides under `overrides` section rather than re-excluding tests
- [ ] Run `npm run lint` — record the error count and category breakdown in STATUS.md Discoveries (this is the inventory TP-192 will use)
- [ ] Run `npm run format:check` — should fail on most files (formatter is disabled today; this confirms format:check is wired)

### Step 5: Implement Parts 4-6 — reviewer discoverability, activation note, CI workflow

- [ ] Update `.pi/taskplane-config.json` `taskRunner.testing.commands` to add `typecheck`, `lint`, and `format:check` (so TP-188 reviewer's discovery loop finds them)
- [ ] Add temporary activation note to `templates/agents/task-reviewer.md` per spec section 6.1.6 wording
- [ ] Update `.github/workflows/ci.yml` lint step from `npx @biomejs/biome@2 lint --max-diagnostics=50 --reporter=github .` to `npm run lint` (still `continue-on-error: true`)
- [ ] Verify CI workflow YAML is valid: `gh workflow view ci.yml` or local YAML lint

### Step 6: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] FULL fast suite passes: `cd extensions && npm run test:fast` — target 3624+ passing / 1 skipped / 0 failed (no test changes in this task)
- [ ] FULL integration suite passes
- [ ] CLI smoke clean: `node bin/taskplane.mjs help`, `node bin/taskplane.mjs doctor`
- [ ] `npm run typecheck` runs to completion (may exit non-zero — record final count for TP-192/TP-194 baseline)
- [ ] `npm run lint` runs to completion (will surface ~10 errors per spec section 6.2.1 inventory)
- [ ] `npm run format:check` runs to completion (will fail; formatter still disabled in this task)
- [ ] No new circular imports

### Step 7: Documentation & Delivery

- [ ] CHANGELOG entry under `[Unreleased]` → `Internal`:
  - Title: `**Code-quality prep — scripts, tool pinning, pi-shims (TP-191)**`
  - Body: 1-paragraph summary covering scripts added, tools pinned, shims created, Biome modernized, reviewer-config updated. Reference the spec.
- [ ] Discoveries logged in STATUS.md (typecheck error count, lint error count + categories, any shim refinements from Step 3)
- [ ] Step boundaries committed with `feat(TP-191): ...` / `chore(TP-191): ...` / `docs(TP-191): ...` prefixes

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — add Internal entry per Step 7

**Check If Affected:**
- `docs/maintainers/development-setup.md` — if it documents how to set up tooling, add a note about the new scripts (full doc updates are TP-194's job)

## Completion Criteria

- [ ] All scripts (`typecheck`, `lint`, `format`, `format:check`) defined and executable
- [ ] Both pi-package scopes resolve via shims at typecheck time
- [ ] Biome config modernized; tests in scope
- [ ] Reviewer agent can find typecheck/lint/format:check via `.pi/taskplane-config.json`
- [ ] All tests passing (3624+)
- [ ] Per-step plan + code reviews completed and APPROVE'd
- [ ] CHANGELOG entry added

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-191): complete Step N — description`
- **Bug fixes:** `fix(TP-191): description`
- **Tests:** `test(TP-191): description`
- **Hydration:** `hydrate: TP-191 expand Step N checkboxes`

## Do NOT

- **Don't run `biome format --write`** — formatter adoption is TP-193's scope. Keep the formatter disabled.
- **Don't fix existing lint errors** — that's TP-192's scope. Just inventory them in Discoveries.
- **Don't remove `continue-on-error: true` from the lint step** — gate flip is TP-194's scope.
- **Don't activate the reviewer downgrade rule** — keep the temporary "Issues Found but no REVISE downgrade" note in `task-reviewer.md`. Activation is TP-194's scope.
- **Don't include `dashboard/public/`** in any of the new gates' scopes — it's intentionally vanilla JS, out of scope per spec section 3.
- **Don't change tsconfig.json** (the editor-facing one) — the new CI tsconfig is a SEPARATE file. The editor config stays as-is.
- **Don't expand task scope** — if Step 1 discovery surfaces deeper architectural issues (e.g., circular import the typecheck reveals), document in Discoveries and stop. Add tech debt to CONTEXT.md instead of expanding this task.
- **Don't load docs not listed in "Context to Read First."**
- **Don't commit without the `TP-191` prefix.**

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
