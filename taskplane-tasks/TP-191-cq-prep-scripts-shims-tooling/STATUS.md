# TP-191: Code-quality prep — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ Order of Operations rule (live in worker prompt):** do NOT mark a step
> `Complete` until that step's code review has returned APPROVE. This task
> is Review Level 2 — per-step plan + code reviews fire automatically.
>
> **Review structure:** per-step reviews. Expected: ~5 plan + ~5 code = ~10
> reviews total (with Steps 0/6/7 being lighter).

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (lane worktree)
- [ ] Spec read in full: `docs/specifications/taskplane/code-quality-gates.md`
- [ ] All Tier 3 context files read (existing tsconfig.json, tsconfig.test.json, tests/mocks/pi-coding-agent.ts, tests/mocks/pi-tui.ts, biome.json, .github/workflows/ci.yml lint step, .pi/taskplane-config.json testing.commands, templates/agents/task-reviewer.md TP-188 section, package.json scripts block — currently empty)
- [ ] Baseline test count recorded (target: 3624 passing / 1 skipped / 0 failed post-TP-190)
- [ ] Decision recorded: shim source strategy (lean: hand-written minimal stubs)
- [ ] Pinned versions confirmed available on npm: `@biomejs/biome@2.4.15`, `typescript@5.6.3`

---

### Step 1: Plan all six implementation parts
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural choices.

- [ ] Part 1 design (scripts in package.json — names match TP-188 reviewer expectations)
- [ ] Part 2 design (pi-shims — minimum surface from grep of taskplane source)
- [ ] Part 3 design (tsconfig.ci.json structure + path mappings)
- [ ] Part 4 design (biome.json migration: experimentalScannerIgnores → ignore + scope expansion + $schema)
- [ ] Part 5 design (.pi/taskplane-config.json discoverability + reviewer activation note wording)
- [ ] Part 6 design (CI workflow lint step using npm run lint)
- [ ] Drafts in Discoveries

---

### Step 2: Implement Part 1 — package.json scripts and pinned dev deps
**Status:** ⬜ Not Started

> Plan-reviewer must have APPROVED Step 1 before proceeding.
> ⚠️ Code-review fires after this step.

- [ ] `scripts` block added (typecheck, lint, format, format:check)
- [ ] `devDependencies` added (Biome 2.4.15, TypeScript 5.6.3)
- [ ] `npm install` succeeds; `package-lock.json` refreshed
- [ ] All four scripts execute to completion (non-zero exit OK at this stage)
- [ ] Full fast suite still passes (no behavior change)

---

### Step 3: Implement Part 2 — pi-shims and tsconfig.ci.json
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] `extensions/types/pi-shims.d.ts` created with `declare module` for both Pi scopes
- [ ] `extensions/tsconfig.ci.json` created with paths + comprehensive include
- [ ] `extensions/tsconfig.test.json` updated to add `@earendil-works/*` mappings (back-compat for `@mariozechner/*` preserved)
- [ ] `npm run typecheck` runs without `Cannot find module` errors (TYPE errors are expected; capture count)
- [ ] Pre-cleanup typecheck error count recorded in Discoveries

---

### Step 4: Implement Part 3 — Biome config modernization
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] `biome.json` `experimentalScannerIgnores` migrated to `ignore`
- [ ] `$schema` URL updated to match Biome 2.4.15
- [ ] `includes` expanded: `bin/**/*.mjs`, `scripts/**/*.mjs`, tests in scope
- [ ] `dashboard/public/**`, `extensions/types/**`, `.pi/**`, `.worktrees/**` excluded
- [ ] If test-file lint noise is high, per-rule overrides added under `overrides` (sage's recommendation per spec 7.2)
- [ ] `npm run lint` produces inventory for TP-192 (count + category breakdown in Discoveries)
- [ ] `npm run format:check` runs (will fail; formatter disabled until TP-193)

---

### Step 5: Implement Parts 4-6 — reviewer discoverability, activation note, CI workflow
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] `.pi/taskplane-config.json` `taskRunner.testing.commands` adds typecheck, lint, format:check
- [ ] `templates/agents/task-reviewer.md` carries temporary activation note (per spec 6.1.6)
- [ ] `.github/workflows/ci.yml` lint step uses `npm run lint` (still `continue-on-error: true`)
- [ ] CI workflow YAML validates

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passes: 3624+ passing / 1 skipped / 0 failed
- [ ] FULL integration suite passes
- [ ] CLI smoke clean
- [ ] All four scripts run to completion
- [ ] No circular imports introduced

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entry under [Unreleased] → Internal added
- [ ] Discoveries logged below
- [ ] All commits include `TP-191` prefix

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

**Critical scope reminder:** this task is **prep only**. No gating changes, no formatter adoption, no lint cleanup, no reviewer downgrade rule activation. Each of those is its own follow-up packet (TP-192, TP-193, TP-194). The Do NOT list in PROMPT.md captures these scope boundaries explicitly.

**Pi-shim hand-written approach:** per spec section 7.1, start with hand-written minimal stubs seeded from `tests/mocks/pi-*.ts` shapes. The tests/mocks files are runtime mocks (with implementations); the shims are types-only. Don't point shims AT the mocks — `declare module` blocks in the .d.ts file should declare the type shapes directly. Refine on first tsc failure.

**Pinned-version exception clause:** if `@biomejs/biome@2.4.15` is no longer the latest 2.x at task-execution time, use the latest stable in the same minor line and document the choice in Discoveries. Same for TypeScript 5.6.3 — use latest stable 5.x if a newer one exists. Major-version drift (e.g., Biome 3.x) should NOT be picked up automatically without operator confirmation.
