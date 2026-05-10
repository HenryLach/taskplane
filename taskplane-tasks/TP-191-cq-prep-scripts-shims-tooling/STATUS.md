# TP-191: Code-quality prep — Status

**Current Step:** Step 2: Implement Part 1 — package.json scripts and pinned dev deps
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
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
**Status:** ✅ Complete

- [x] On `main` (lane worktree) — branch `task/henrylach-lane-1-20260510T104217` (lane worktree forked from main)
- [x] Spec read in full: `docs/specifications/taskplane/code-quality-gates.md` (sections 1-4, 6.1, 7, 8, 9 read)
- [x] All Tier 3 context files read (existing tsconfig.json, tsconfig.test.json, tests/mocks/pi-coding-agent.ts, tests/mocks/pi-tui.ts, biome.json, .github/workflows/ci.yml lint step, .pi/taskplane-config.json testing.commands, templates/agents/task-reviewer.md TP-188 section, package.json scripts block — currently empty)
- [x] Baseline test count recorded: **3624 passing / 1 skipped / 0 failed** (3625 total, fast suite, ~38s) — matches target
- [x] Decision recorded: shim source strategy → hand-written minimal stubs in `extensions/types/pi-shims.d.ts` (per spec section 7.1 lean), seeded from `tests/mocks/pi-*.ts` shapes; refine on first tsc failure
- [x] Pinned versions confirmed on npm: `@biomejs/biome@2.4.15` (current `latest` dist-tag, also latest 2.4.x), `typescript@5.6.3` (latest 5.6.x; newer stables 5.7-5.9 + 6.0 exist but per `same minor line` rule we stay at 5.6.3)

---

### Step 1: Plan all six implementation parts
**Status:** ✅ Complete (plan review R001 APPROVE)

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural choices.

- [x] Part 1 design (scripts in package.json — names match TP-188 reviewer expectations) — see Plan section below
- [x] Part 2 design (pi-shims — minimum surface from grep of taskplane source) — see Plan section below
- [x] Part 3 design (tsconfig.ci.json structure + path mappings) — see Plan section below
- [x] Part 4 design (biome.json migration: experimentalScannerIgnores → ignore + scope expansion + $schema) — see Plan section below
- [x] Part 5 design (.pi/taskplane-config.json discoverability + reviewer activation note wording) — see Plan section below
- [x] Part 6 design (CI workflow lint step using npm run lint) — see Plan section below
- [x] Plan drafts written below (this file) — ready for plan-review

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
| 1 | plan | 1 | APPROVE | .reviews/R001-plan-step1.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Baseline tests: 3624 passing / 1 skipped / 0 failed | Recorded as TP-191 baseline; Step 6 will re-run | extensions fast suite |
| TypeScript `latest` is now 6.0.3, with 5.7–5.9 stables also available | Stayed on 5.6.3 per `same minor line` rule (latest 5.6.x); spec also called for 5.6.3 | package.json devDependencies (Step 2) |
| Biome `latest` dist-tag is 2.4.15 (matches spec) | Use 2.4.15 as pinned | package.json + biome.json $schema (Step 2/4) |
| Source-tree pi imports today: only `@mariozechner/*` scope (4 pi-ai, 7 pi-coding-agent, 2 pi-tui imports) | Shim BOTH scopes anyway per spec 6.1.3 (forward-compat for `@earendil-works/*` migration) | shim file (Step 3) |
| Pi-package import surface (consumed exports): `ExtensionAPI`, `ExtensionContext` (types) from pi-coding-agent; `DynamicBorder`, `getSettingsListTheme` (values) from pi-coding-agent; `Type` (value) from pi-ai; `Model`, `Api` (types) from pi-ai; `Container`, `Text`, `SelectList`, `SettingsList`, `truncateToWidth` (values), `SelectItem`, `SettingItem` (types) from pi-tui | Drives shim minimum surface (Step 3) | extensions/**/*.ts grep |
| `.pi/` is gitignored — changes to `.pi/taskplane-config.json` will not be committed/merged | Modify the project-local `.pi/taskplane-config.json` in the lane worktree per PROMPT file scope; orchestrator/operator handles propagation | `.pi/taskplane-config.json` (Step 5) |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 14:42 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 14:42 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Plan (Step 1 drafts)

### Part 1 — `package.json` scripts and pinned dev deps

**Scripts block** (root `package.json`):
```json
"scripts": {
  "typecheck": "tsc --project extensions/tsconfig.ci.json --noEmit",
  "lint": "biome lint .",
  "format": "biome format --write .",
  "format:check": "biome format ."
}
```
Verbatim from spec section 6.1.1. Names (`typecheck`, `lint`, `format`, `format:check`) match the reviewer's TP-188 discovery list (template `task-reviewer.md` lines 70-83).

**devDependencies**:
```json
"devDependencies": {
  "@biomejs/biome": "2.4.15",
  "typescript": "5.6.3"
}
```
Exact pins (no `^` prefix). Both verified on npm in Step 0. Local `node_modules/.bin/{biome,tsc}` resolves the bare commands; no `npx` needed.

**Why these script names invoke bare tools (not `npx`):** `npm run` adds `node_modules/.bin` to PATH, so `biome` and `tsc` resolve to the pinned local versions. This is how the reviewer agent's discovery loop expects them (it shells out via `npm run <name>`).

**Side effect:** `npm install` will create a root-level `node_modules/` and refresh `package-lock.json`. The repo currently has only `extensions/node_modules` (per `extensions/package-lock.json`). Adding root deps is necessary but kept minimal (only Biome + TypeScript).

### Part 2 — `extensions/types/pi-shims.d.ts`

Hand-written minimal stubs covering both pi scopes (`@earendil-works/*` AND `@mariozechner/*`). Surface seeded by grep of `extensions/**/*.ts` (consumed exports per Discoveries table):

- **`pi-coding-agent`**: type `ExtensionAPI`, type `ExtensionContext`, value class `DynamicBorder`, value function `getSettingsListTheme()`
- **`pi-ai`**: value `Type` (TypeBox-like — declared as `any` value to satisfy `Type.Object(...)`, `Type.String(...)` calls), type `Model<Api>`, type `Api`
- **`pi-tui`**: value classes `Container`, `Text`, `SelectList`, `SettingsList`; value function `truncateToWidth(input: string): string`; types `SelectItem`, `SettingItem`

**Both scopes get identical shapes** in two `declare module` blocks each (one per scope) per spec section 6.1.3. No re-export tricks; just literal duplication so resolution from either scope is identical.

**Type strictness:** intentionally permissive (`any` for class internals, no method bodies) — these only need to satisfy `tsc --noEmit` resolution. The IDE picks up real types from installed pi packages; the shim only matters for headless CI typecheck.

**Maintenance note** (in file header): "when taskplane starts using a new pi export, add its shape here. The first `tsc` failure after such a change is the canary — extend this file rather than disabling typecheck."

### Part 3 — `extensions/tsconfig.ci.json` + `tsconfig.test.json` update

**New file `extensions/tsconfig.ci.json`** (verbatim from spec section 6.1.3):
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"],
    "paths": {
      "@earendil-works/*": ["types/pi-shims.d.ts"],
      "@mariozechner/*": ["types/pi-shims.d.ts"]
    }
  },
  "include": [
    "task-orchestrator.ts",
    "reviewer-extension.ts",
    "taskplane/**/*.ts",
    "tests/**/*.ts",
    "types/**/*.d.ts"
  ],
  "exclude": []
}
```
Note: spec section 6.1.3's snippet doesn't show the `paths` mapping explicitly under `compilerOptions`, but the rationale ("shims that only matter to headless tsc") requires path mappings to point both pi scopes at the shim. Confirmed by checking that `tsconfig.test.json` uses the same pattern for test mocks.

**Why a separate file** (not modifying `tsconfig.json`): preserve existing editor experience (per spec rationale + PROMPT "Don't change tsconfig.json").

**Update `extensions/tsconfig.test.json`**: add `@earendil-works/*` mappings alongside existing `@mariozechner/*`:
```json
"paths": {
  "@mariozechner/pi-coding-agent": ["tests/mocks/pi-coding-agent.ts"],
  "@mariozechner/pi-tui": ["tests/mocks/pi-tui.ts"],
  "@earendil-works/pi-coding-agent": ["tests/mocks/pi-coding-agent.ts"],
  "@earendil-works/pi-tui": ["tests/mocks/pi-tui.ts"]
}
```
Back-compat: existing `@mariozechner/*` keys preserved.

### Part 4 — `biome.json` modernization

Verbatim shape from spec section 6.1.5, applied as a diff against current `biome.json`:

- **`$schema`**: `https://biomejs.dev/schemas/2.0.6/schema.json` → `https://biomejs.dev/schemas/2.4.15/schema.json`
- **`files.includes`**: expand from `["extensions/**/*.ts"]` to `["extensions/**/*.ts", "extensions/**/*.tsx", "bin/**/*.mjs", "scripts/**/*.mjs"]`
- **`files.experimentalScannerIgnores`** → **`files.ignore`** (deprecated key migrated). New ignore list: `["node_modules/**", "dashboard/public/**", "extensions/types/**", ".pi/**", ".worktrees/**"]`
- **Tests now in scope** (sage's recommendation per spec 7.2). Tests are matched by `extensions/**/*.ts`. If lint reveals high noise from tests, add per-rule overrides under `overrides` rather than re-excluding (this is what Step 4's checklist captures).
- **`linter.rules`**: unchanged (preserve current overrides).
- **`formatter.enabled`**: stays `false` (TP-193's job).

### Part 5 — `.pi/taskplane-config.json` + `templates/agents/task-reviewer.md`

**`.pi/taskplane-config.json`** — expand `taskRunner.testing.commands` from current single `test` key to:
```json
"commands": {
  "test": "<existing>",
  "typecheck": "npm run typecheck",
  "lint": "npm run lint",
  "format:check": "npm run format:check"
}
```
Spec section 6.1.4 verbatim. Reviewer's discovery loop reads this first (template lines 64-72).

**Note on `.pi/` gitignore:** `.pi/` is gitignored (verified Step 0). The lane worktree has no `.pi/` today — I'll create `.pi/taskplane-config.json` in the lane worktree by copying the current main repo's config + adding the three new keys. The change is local to the worktree and won't merge via git, but the PROMPT explicitly lists the file in scope so the orchestrator/operator handles propagation. No code path breaks if the file is absent on a fresh clone (the reviewer falls back to `package.json#scripts`).

**`templates/agents/task-reviewer.md`** — add a one-block activation note immediately under the `## Quality-check verification (code reviews only)` heading (line 53), per spec 6.1.6 wording verbatim:

```markdown
> **Activation status (post-PR-A):** The typecheck/lint/format:check
> scripts referenced in this section are now defined in the project's
> `package.json`. The Quality-check verification logic IS active, but
> until the gating PR (TP-194) lands, lint failures are surfaced as
> Issues Found but NOT downgraded to REVISE (because pre-existing
> errors in `main` are not the worker's fault). After TP-194, the
> downgrade rule fires normally.
```

This is a **temporary** block — TP-194 removes it.

### Part 6 — `.github/workflows/ci.yml` lint step

Replace lines 32-33:
```yaml
      - name: Lint (Biome)
        continue-on-error: true
        run: npx @biomejs/biome@2 lint --max-diagnostics=50 --reporter=github .
```
with:
```yaml
      - name: Lint (Biome)
        continue-on-error: true   # NOTE: kept until TP-194
        run: npm run lint
```

**Pre-condition for CI to find the script:** `npm install` must run at the repo root before the lint step. Currently the workflow runs `npm ci --prefix extensions` only. Need to add a root-level install step OR use `npx biome lint .` directly.

**Decision:** add a root install step before the lint step. The new root `package.json` declares Biome + TypeScript as devDependencies, so we need `npm install` (or `npm ci` if a root `package-lock.json` exists — it will after Step 2). Add:
```yaml
      - name: Install root dev dependencies
        run: npm ci
```
(positioned BEFORE the lint step, AFTER `npm ci --prefix extensions`).

**Cache key update:** the existing `actions/setup-node@v6` step caches via `cache-dependency-path: extensions/package-lock.json`. Adding a root lockfile means cache should also include it. Update to a multi-line list:
```yaml
          cache-dependency-path: |
            extensions/package-lock.json
            package-lock.json
```

**`continue-on-error: true` STAYS** (TP-194 removes it).

---

## Notes

**Critical scope reminder:** this task is **prep only**. No gating changes, no formatter adoption, no lint cleanup, no reviewer downgrade rule activation. Each of those is its own follow-up packet (TP-192, TP-193, TP-194). The Do NOT list in PROMPT.md captures these scope boundaries explicitly.

**Pi-shim hand-written approach:** per spec section 7.1, start with hand-written minimal stubs seeded from `tests/mocks/pi-*.ts` shapes. The tests/mocks files are runtime mocks (with implementations); the shims are types-only. Don't point shims AT the mocks — `declare module` blocks in the .d.ts file should declare the type shapes directly. Refine on first tsc failure.

**Pinned-version exception clause:** if `@biomejs/biome@2.4.15` is no longer the latest 2.x at task-execution time, use the latest stable in the same minor line and document the choice in Discoveries. Same for TypeScript 5.6.3 — use latest stable 5.x if a newer one exists. Major-version drift (e.g., Biome 3.x) should NOT be picked up automatically without operator confirmation.
| 2026-05-10 14:48 | Review R001 | plan Step 1: APPROVE |
