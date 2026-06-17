# Code Quality Gates: typecheck, lint, format — Specification

**Status:** Proposed
**Created:** 2026-05-10
**Author:** Supervisor session (with sage design consultation)
**Triggers:** Issue #559 (TP-187 `ReferenceError: batchState is not defined`) + the broader observation that Taskplane has grown beyond its original "small extension" scope without ever adopting standard static-analysis gates.

> **TL;DR:** Taskplane has 50+ TypeScript source files, 700+ test suites, 3624 tests, and zero static-analysis gates at PR time. Biome lint runs in CI but `continue-on-error: true` makes it decoration. There is no `tsc --noEmit`. There is no `format:check`. The TP-188 reviewer-agent capability that runs `npm run typecheck` / `lint` / `format:check` is dormant because those scripts don't exist. This spec proposes a sequenced rollout: **TP-191 (prep) → TP-192 (lint cleanup) → TP-193 (format adoption) → TP-195 (typecheck cleanup, inserted post-TP-191) → TP-194 (the gate flip)**, with Tier-1.5 follow-ups (TS strictness ratchet, CHANGELOG fragments) staged as their own task packets after TP-194 stabilizes.
>
> **Spec amendment 2026-05-10 (post-TP-191 merge):** TP-195 was inserted between TP-193 and TP-194 because TP-191's first `npm run typecheck` run surfaced 267 errors at non-strict level. Sage's post-TP-191 review confirmed these are real contract drift (~198 in tests, ~69 in source), not pi-shim under-declaration, and recommended a dedicated cleanup packet rather than expanding TP-194's scope. TP-194's CRITICAL pre-condition (typecheck-exit-0 on main) requires TP-195 to merge first.

---

## 1. Problem

### 1.1 The gap

Taskplane started as "a small extension" and accreted into a substantial codebase without adopting the static-analysis baseline most TypeScript projects have at this scale. Today:

| Surface | State | Impact |
|---|---|---|
| **Tests** | ✅ Strong (3624 tests, native `node:test`) | Project's actual quality floor |
| **Biome lint** | ⚠️ Runs in CI but `continue-on-error: true` | Decoration; ~10 real lint errors sit in `main` today |
| **Typecheck (`tsc --noEmit`)** | ❌ Not run anywhere | TP-187 #559 (`ReferenceError`) shipped because of this |
| **Format (`biome format`)** | ❌ Formatter disabled in `biome.json` | No enforcement; style drift |
| **Pre-commit hooks** | ❌ None | Issues caught by CI, not by developers |
| **Test coverage** | ❌ Not tracked | Under-tested areas invisible |
| **TP-188 reviewer quality checks** | ❌ Dormant — scripts don't exist | Activates capability we already paid for |

### 1.2 Concrete evidence of cost

**Issue #559** (May 2026): My TP-187 sage-fold commit referenced `batchState.batchId` in the supervisor IPC closure. `batchState` is not bound in that scope — only `orchBatchState` and `supervisorState` are. The bug crashed every batch on the first IPC frame.

It slipped through:

1. `node --experimental-strip-types` performs no name resolution; only strips type annotations.
2. The TP-187 in-batch tests mock IPC handlers at a different layer, bypassing the actual extension closure.
3. CI smoke checks (`taskplane help`, `taskplane doctor`) don't construct the closure.

**`tsc --noEmit` would have caught it** at PR time as `error TS2304: Cannot find name 'batchState'`.

### 1.3 Why now

- Polyrepo testing now exists (`polyrepo-smoke-test` skill + `tp-test-workspace`), but pre-release smoke is still discovery-driven and won't catch every static-analysis-class regression.
- The TP-188 reviewer agent already tries to run typecheck/lint/format:check. Adding the scripts activates dormant capability we already specified.
- Five issues closed in v0.29.0 included two (#559, #560) that landed in `main` and were caught only by post-merge polyrepo smoke. Static gates would have caught at least one (#559) earlier and reduced the post-merge diagnosis surface.

---

## 2. Goals

1. **Eliminate the #559 class of bug** at PR time via `tsc --noEmit`.
2. **Make Biome lint a real gate**, not a warning. Fix existing errors first.
3. **Enforce consistent formatting** across the codebase via `biome format`.
4. **Activate the dormant TP-188 reviewer-agent quality checks** by making the scripts discoverable and runnable.
5. **Sequence safely** so the rollout doesn't destabilize in-flight PRs or trigger reviewer-agent false-REVISEs on pre-existing errors.
6. **Lay groundwork for Tier-1.5 follow-ups** (TS strictness ratchet, CHANGELOG fragment system) without coupling them to this work.

## 3. Non-goals (explicit)

- **TypeScript strict mode in this rollout.** Sage's design feedback: enabling `strict: true` while simultaneously introducing typecheck would surface many errors at once and turn the gating PR into a multi-week refactor. Tier-1 gets `tsc --noEmit` green at **current** strictness (`strict: false`, `noImplicitAny: false`). Strictness ratchet is Tier-1.5 (Section 9).
- **Test coverage tracking (c8).** Explicitly deferred to Tier-2 (Section 10). Listed there so it isn't lost.
- **API surface documentation (TSDoc + `@internal`).** Tier-2.
- **Pre-commit hooks (Husky / lint-staged).** Tier-2 — once gates are stable in CI, add developer-side acceleration.
- **CHANGELOG fragment system.** Promoted to **Tier-1.5 immediate follow-up** (Section 9), not deferred to Tier-2.
- **Dashboard `dashboard/public/*.js`** is OUT of scope for these gates (intentionally loose vanilla JS). Future work could add a separate `dashboard.biome.json` opt-in.

---

## 4. Current state — confirmed

### 4.1 `extensions/tsconfig.json`

```json
{
  "// NOTE": "Pi extensions are runtime-transpiled by pi's bundler. This tsconfig is for editor/CI type-checking only. Full tsc --noEmit will report module resolution errors for @earendil-works/* packages — and legacy @mariozechner/* aliases retained for back-compat — because pi packages are globally installed (not in node_modules). See extensions/tsconfig.ci.json for the CI variant that adds pi-shims path mappings.",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": false,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noImplicitAny": false
  },
  "include": ["task-orchestrator.ts"],
  "exclude": ["tests"]
}
```

**Three real problems:**

1. The pi packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` — and legacy `@mariozechner/*`) are NOT in `node_modules`. They live at `npm root -g/<scope>/<pkg>` and are aliased at runtime by Pi's extension loader. `tsc --noEmit` cannot resolve them.
2. `include: ["task-orchestrator.ts"]` only covers ONE entry point. The reviewer extension and the rest of `extensions/taskplane/` are excluded from typecheck scope today.
3. ~~The `// NOTE` comment in this file is **stale** — it still references `@mariozechner/*` only, even though the canonical scope is now `@earendil-works/*` (per issue #560 and Pi v0.74.0). This is a historical reference, not the current canonical scope. **TP-191 will refresh the comment** as part of the tsconfig modernization.~~ **(Addressed 2026-06-17:** the comment now mentions both scopes — `@earendil-works/*` as canonical, `@mariozechner/*` as legacy back-compat — and points readers at `tsconfig.ci.json` for the CI-shim path mappings. This was overlooked during the TP-191 implementation and folded into a follow-up cleanup pass.**)**

### 4.2 `extensions/tsconfig.test.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@mariozechner/pi-coding-agent": ["tests/mocks/pi-coding-agent.ts"],
      "@mariozechner/pi-tui": ["tests/mocks/pi-tui.ts"]
    }
  },
  "include": ["task-orchestrator.ts", "tests/**/*.ts"]
}
```

**Stale post-#560:** still references `@mariozechner` only. New scope `@earendil-works` not mapped. Test runtime works because of the loader-hooks redirection, but tsc would fail on test files importing from the new scope.

### 4.3 `biome.json`

```json
{
  "files": {
    "includes": ["extensions/**/*.ts"],
    "experimentalScannerIgnores": ["extensions/tests/**", "node_modules/**"]
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": { "noExplicitAny": "off", "noAssignInExpressions": "off" },
      "complexity": { "noForEach": "off", "noExcessiveCognitiveComplexity": "off" },
      "style": { "noNonNullAssertion": "off", "useConst": "off", "noParameterAssign": "off", ... },
      "correctness": { "noUnusedVariables": "warn", "noUnusedImports": "warn" }
    }
  },
  "formatter": { "enabled": false }
}
```

**Notes:**

- `experimentalScannerIgnores` is **deprecated** in Biome 2.x — must migrate while we're touching the config.
- `formatter.enabled: false` — the formatter is configured-out today.
- Tests excluded from lint entirely.
- Many "recommended" style rules are turned off; this is fine but should be intentional after this rollout, not accidental.

### 4.4 `.github/workflows/ci.yml`

```yaml
- name: Lint (Biome)
  continue-on-error: true   # ← this is the gate that isn't a gate
  run: npx @biomejs/biome@2 lint --max-diagnostics=50 --reporter=github .
```

**Two issues:**

- `continue-on-error: true` — lint failures don't fail the build.
- `npx @biomejs/biome@2 lint` — version drift potential. Should use a pinned dev-dependency, not `npx ...@2`.

### 4.5 Reviewer-agent dormant capability

`templates/agents/task-reviewer.md` (per TP-188, shipped v0.28.8):

```markdown
## Quality-check verification

Discover commands by reading `.pi/taskplane-config.json` `taskRunner.testing.commands` first,
then fall back to `package.json` `scripts` for `typecheck` / `lint` / `format:check`.

Run any matching commands using your `bash` tool. Surface failures as **Issues Found** with
severity `important`. Downgrade an otherwise-APPROVE verdict to **REVISE** when any quality
check fails.
```

**Today's `package.json#scripts`:** none. **Today's `.pi/taskplane-config.json#testing.commands`:** only `test`. So the reviewer's discovery loop finds nothing matching `typecheck`/`lint`/`format:check` and skips. The whole TP-188 subsystem is dormant.

---

## 5. Sequenced rollout (high-level)

The rollout is **five PRs** in strict order. Each PR is small enough to ship cleanly; together they close the gap.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ A. Prep PR              [scripts + version pinning + shims + scanner config]│
│ ↓                                                                            │
│ B. Lint-cleanup PR      [fix existing Biome errors in main]                 │
│ ↓                                                                            │
│ C. Format-adoption PR   [biome format --write once + .git-blame-ignore-revs]│
│ ↓                                                                            │
│ D. TP-194 (the gate)    [remove continue-on-error, add typecheck job,       │
│                          add format:check job, activate reviewer downgrade] │
│ ↓                                                                            │
│ E. Tier-1.5 follow-ups  [TS strictness ratchet, CHANGELOG fragments]        │
└─────────────────────────────────────────────────────────────────────────────┘
```

The order matters. Detail in Section 6.

**Spec amendment 2026-05-10:** TP-195 (typecheck cleanup) was inserted between PRs C and D after TP-191 surfaced 267 typecheck errors. The diagram above predates the amendment; the actual sequence is:

- A. TP-191 Prep
- B. TP-192 Lint cleanup
- C. TP-193 Format pass
- **D. TP-195 Typecheck cleanup (inserted; sage post-TP-191 recommendation)**
- E. TP-194 Gate flip
- F. Tier-1.5 follow-ups (TS strictness ratchet, CHANGELOG fragments)

TP-194's CRITICAL pre-condition (typecheck-exit-0 on main) requires TP-195 to merge first. The TP-195 packet is in `taskplane-tasks/TP-195-cq-typecheck-cleanup/`.

---

## 6. Detailed plan per PR

### 6.1 PR A — Prep PR (TP-191)

**Mission:** add the foundational pieces (scripts, version pins, type shims, reviewer-discoverable commands) so the gates can be flipped safely later. **No** gating changes in this PR.

#### 6.1.1 Add npm scripts

Root `package.json` — currently has NO `scripts` block. Add:

```json
{
  "scripts": {
    "typecheck": "tsc --project extensions/tsconfig.ci.json --noEmit",
    "lint": "biome lint .",
    "format": "biome format --write .",
    "format:check": "biome format ."
  }
}
```

**Rationale for naming:**
- `typecheck` (not `tsc`) — semantic name; reviewer agent looks for this exact name.
- `format:check` — matches the reviewer's discovery list verbatim.
- `format` (without `:check`) — convenience for developers; not used by CI.

#### 6.1.2 Pin tool versions

Add to `devDependencies`:

```json
"devDependencies": {
  "@biomejs/biome": "2.4.15",
  "typescript": "5.6.3"
}
```

**Versions selected:** Biome `2.4.15` is the current `latest` dist-tag at spec authoring time (2026-05-10). The existing `biome.json` schema URL references `2.0.6` (the version the config was originally written against) but CI today runs `npx @biomejs/biome@2` which resolves to whatever is current in the 2.x line — hence the version drift the pin eliminates. Pinning 2.4.15 also requires updating the `$schema` URL in `biome.json` to match (see 6.1.5).

**Removes** `npx ...@latest` and `npx @biomejs/biome@2` drift. CI now uses the pinned versions via the local install. **Action:** update `biome.json` `$schema` URL from `2.0.6` to `2.4.15` to match (covered in 6.1.5).

Update `.github/workflows/ci.yml` lint step:

```yaml
- name: Lint (Biome)
  continue-on-error: true   # NOTE: kept until PR D
  run: npm run lint
```

#### 6.1.3 Add `extensions/tsconfig.ci.json` and pi-package shims

Per sage's recommendation: option (a) with **dedicated shims** (not test mocks).

New file: `extensions/types/pi-shims.d.ts`

```typescript
/**
 * Type-only stubs for Pi packages so `tsc --noEmit` can resolve the
 * compile-time imports. Pi's extension loader handles the actual runtime
 * resolution via its bundled-module aliasing (see `pi-coding-agent/dist/core/extensions/loader.js`).
 *
 * Issue #560 left taskplane's source still referencing the legacy
 * `@mariozechner/*` scope. Pi's runtime aliases both, so we stub both
 * here so neither path breaks tsc.
 *
 * For the pieces taskplane actually consumes from each pi package, declare
 * the minimal shape needed to satisfy tsc. Real types live in the installed
 * pi packages and are read by the IDE; this shim only exists for headless
 * `tsc --noEmit` runs.
 *
 * **Maintenance note:** when taskplane starts using a new pi export, add
 * its shape here. The first `tsc` failure after such a change is the
 * canary — extend this file rather than disabling typecheck.
 */

declare module "@earendil-works/pi-coding-agent" {
  // Minimal surface used by taskplane (matches tests/mocks/pi-coding-agent.ts).
  export interface ExtensionAPI { /* ... */ }
  export interface ExtensionContext { /* ... */ }
  // ... other exports
}

declare module "@earendil-works/pi-ai" {
  export const Type: any;
  // ...
}

declare module "@earendil-works/pi-tui" {
  // ...
}

// Legacy scope — same shapes, separate declare so an import from
// either scope resolves identically (mirrors pi's runtime aliasing).
declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionAPI { /* ... */ }
  // ...
}
declare module "@mariozechner/pi-ai" { /* ... */ }
declare module "@mariozechner/pi-tui" { /* ... */ }
```

**Source of truth for shapes:** `extensions/tests/mocks/pi-coding-agent.ts` and `pi-tui.ts`. Use those as the seed; refine if tsc complains. Keeping them as `.d.ts` (declarations only) means no runtime impact.

New file: `extensions/tsconfig.ci.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"]
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

**Why a separate `tsconfig.ci.json`** (not modify `tsconfig.json`):

- The existing `tsconfig.json` is consumed by editors (VSCode, etc.) which already work fine for individual-file typing. Don't break that.
- The CI tsconfig has a different scope concern: comprehensive coverage of all source + tests, with shims that only matter to headless `tsc`.
- Keeps `tsconfig.test.json` (the existing test-runtime config with path mappings to test mocks) separate from CI typecheck.

#### 6.1.4 Update reviewer discoverability

Update `.pi/taskplane-config.json`:

```json
"taskRunner": {
  "testing": {
    "commands": {
      "test": "cd extensions && node --experimental-strip-types ...",
      "typecheck": "npm run typecheck",
      "lint": "npm run lint",
      "format:check": "npm run format:check"
    }
  }
}
```

The reviewer agent's TP-188 discovery loop reads this first. Now it finds all four commands and runs them.

#### 6.1.5 Update Biome config (modernize)

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.15/schema.json",
  "files": {
    "includes": [
      "extensions/**/*.ts",
      "extensions/**/*.tsx",
      "bin/**/*.mjs",
      "scripts/**/*.mjs"
    ],
    "ignore": [
      "node_modules/**",
      "dashboard/public/**",
      "extensions/types/**",
      ".pi/**",
      ".worktrees/**"
    ]
  },
  "linter": { ... },
  "formatter": {
    "enabled": false   // ← NOTE: kept disabled until TP-193 (Format adoption)
  }
}
```

Changes:
- Migrate `experimentalScannerIgnores` → `ignore` (deprecated → current).
- Add `bin/**/*.mjs` and `scripts/**/*.mjs` to scope.
- Tests now INCLUDED in the lint scan (sage's recommendation). If noise is high, add per-rule overrides under `overrides.tests`.
- Dashboard public JS explicitly excluded.

#### 6.1.6 Add reviewer-agent activation note (but keep dormant)

Update `templates/agents/task-reviewer.md` to add a comment block:

```markdown
> **Activation status (post-PR-A):** The typecheck/lint/format:check
> scripts referenced in this section are now defined in the project's
> `package.json`. The Quality-check verification logic IS active, but
> until the gating PR (TP-194) lands, lint failures are surfaced as
> Issues Found but NOT downgraded to REVISE (because pre-existing
> errors in `main` are not the worker's fault). After TP-194, the
> downgrade rule fires normally.
```

This documents the sequencing for future reviewer agents reading the prompt.

#### 6.1.7 Validation for PR A

- `npm run typecheck` produces a non-empty error list (we expect errors at this point — PR A doesn't fix them, it just makes typecheck runnable). Capture the count for PR D's gating.
- `npm run lint` reproduces the existing ~10 errors (no new ones introduced).
- `npm run format:check` produces a "needs formatting" diagnostic for ~every file.
- Tests still pass (no behavior change).
- Reviewer agent on a smoke task can now find all four scripts via `.pi/taskplane-config.json`.

#### 6.1.8 Size and risk

**Size:** S-M. Mostly mechanical (tooling config + shim file).
**Risk:** Low. No behavior changes; only adds capabilities.
**Reviewer level:** 1 (Plan Only) — design choices are mostly sage-validated already.

---

### 6.2 PR B — Lint cleanup (TP-192)

**Mission:** fix the ~10 existing Biome errors in `main` so PR D can promote lint to a gate without breaking the build.

#### 6.2.1 Inventory

After PR A lands, run:

```bash
npm run lint -- --reporter=github > lint-baseline.txt
```

Expect (per recent CI run logs):
- `noUnsafeFinally` — Unsafe usage of `return` in a `finally` block
- `noImplicitAnyLet` × 5 — variables implicitly have the `any` type
- `noControlCharactersInRegex` — control character in regex
- `noRedeclare` — `AllocateLanesResult` and `resolveRepoRoot` redeclared

Update the inventory in this section once PR A is live and the actual count is captured.

#### 6.2.2 Fix strategy

- **Mechanical fixes** (auto-fixable via `biome check --apply` or `--write` on safe rules): apply.
- **Semantic fixes** (type annotations for `noImplicitAnyLet`, regex escapes for `noControlCharactersInRegex`, real refactors for `noRedeclare`): hand-edit with care.

#### 6.2.3 Test coverage check

Each fixed file gets re-run through targeted tests. The full suite must still pass.

#### 6.2.4 Validation

- `npm run lint` exits 0 on a clean main.
- Tests pass: 3624+ passing, 0 failed.
- No behavior change — fixes are surface-level.

#### 6.2.5 Size and risk

**Size:** S-M. ~10 errors; some auto-fixable.
**Risk:** Low. Targeted, mechanical work.
**Reviewer level:** 1 (Plan Only).

---

### 6.3 PR C — Format adoption (TP-193)

**Mission:** turn on the formatter and apply it to the entire codebase in one diff. Add `.git-blame-ignore-revs`.

#### 6.3.1 Configure formatter

`biome.json`:

```json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 1,
    "lineWidth": 100,
    "lineEnding": "lf"
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "trailingCommas": "all",
      "semicolons": "always",
      "arrowParentheses": "always"
    }
  }
}
```

**Choices** (review and adjust before locking):
- **Tabs** — matches existing codebase. The TP-187/189 batch's commits all use tabs per Biome's standard.
- **100-char line width** — pragmatic for engine code with deep nesting.
- **Double quotes** — matches existing codebase.
- **Trailing commas everywhere** — Biome default; reduces diff churn for future edits.
- **Always semicolons** — matches existing codebase.

#### 6.3.2 Apply once

```bash
npm run format
git add -A
git commit -m "chore: apply biome format to entire codebase (formatter adoption)"
```

This will likely touch ~every TS/MJS file in scope (say 50-80 files). The diff is large but mechanical.

#### 6.3.3 Add `.git-blame-ignore-revs`

```bash
echo "<commit-sha-of-format-pass>" >> .git-blame-ignore-revs
git add .git-blame-ignore-revs
git commit -m "chore: add format-adoption commit to .git-blame-ignore-revs"
```

Configure git to use it (one-time, per-developer):

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Document this in the PR body and in `docs/maintainers/development-setup.md`.

#### 6.3.4 Coordinate with in-flight PRs

Per sage's freeze-window recommendation:

- Announce the format-adoption PR 24h in advance.
- Hold all in-flight PRs at "ready to merge" — don't merge new content during the freeze window.
- Land PR C, then any held PRs rebase against the new format. Biome can `format` the rebased work cleanly.

Keep PR C's diff **format-only**. No logic changes. No content changes. Pure mechanical pass.

#### 6.3.5 Validation

- `npm run format:check` exits 0.
- Tests pass: 3624+ passing, 0 failed.
- `npm run lint` exits 0 (lint cleanup from PR B is preserved).
- Diff inspection: confirm only whitespace, quote, and semicolon changes.

#### 6.3.6 Size and risk

**Size:** Mechanically L (line count), conceptually S.
**Risk:** Medium — the rebase coordination is the main pain. Mitigated by the freeze window.
**Reviewer level:** 0 (None) — pure mechanical, easier to spot-check than line-review.

---

### 6.4 PR D — TP-194 (the actual gate flip)

**Mission:** remove `continue-on-error`, add typecheck job, add format:check job, activate reviewer-downgrade rule.

#### 6.4.1 CI workflow updates

Replace the current single lint step with three required steps:

```yaml
- name: Typecheck
  run: npm run typecheck

- name: Lint (Biome)
  run: npm run lint   # NOTE: continue-on-error removed

- name: Format check (Biome)
  run: npm run format:check

# (existing tests step continues unchanged)
```

All three are required status checks. PR can't merge if any fail.

**Decision:** run as separate steps (not consolidated) so failure messages name which gate broke.

#### 6.4.2 Activate reviewer-downgrade rule

Update `templates/agents/task-reviewer.md` — remove the "post-PR-A activation note" added in PR A:

```markdown
## Quality-check verification

[existing TP-188 section, now ACTIVE — downgrade rule fires normally]
```

The reviewer now downgrades APPROVE → REVISE on any failing typecheck/lint/format:check.

**Pre-condition:** `main` must be green on all three gates before this PR lands. PRs B and C ensure this.

#### 6.4.3 Update branch protection

Add the three new CI jobs as required status checks for the `main` branch:

- `Typecheck`
- `Lint (Biome)`
- `Format check (Biome)`

(The existing `Run tests` and `CLI smoke checks` and `Verify docs relative links` remain.)

#### 6.4.4 Update documentation

- `AGENTS.md` — add typecheck/lint/format:check to the validation checklist for any PR.
- `docs/maintainers/release-process.md` — add the three commands to the pre-release validation checklist.
- `docs/maintainers/development-setup.md` — document `npm run typecheck` / `lint` / `format:check` for new contributors.

#### 6.4.5 Validation

- All three gates pass on a fresh `main`.
- Reviewer agent on a smoke task with intentionally-broken code (e.g., undefined identifier) downgrades APPROVE → REVISE with the typecheck error in `Issues Found`.
- Branch protection rejects a PR that fails any of the three gates.

#### 6.4.6 Size and risk

**Size:** M.
**Risk:** Low if PRs A-C are clean (the gates are already passing on main; this just enforces it). Higher if any of A-C is incomplete — fail-fast issues will surface here.
**Reviewer level:** 2 (Plan + Code).

---

### 6.5 Tier-1.5 immediate follow-ups (Section 9)

Once TP-194 is live and stable for ~1 week, the next two task packets become priority:

- **TS strictness ratchet** (Section 9.1).
- **CHANGELOG fragment system** (Section 9.2).

Specs for these are out of scope for this document; outlines in Section 9. Their TP-IDs will be assigned at staging time (after TP-194 lands).

---

## 7. Open decisions (pre-spec finalization)

These need user input before TP-191 through TP-194's PROMPTs are authored:

1. **Pi-shim source-of-truth.** Generate from `tests/mocks/pi-*.ts`, hand-write minimal stubs, or copy from the actual installed pi package's `.d.ts` files? **Recommendation:** start with hand-written minimal stubs (smallest shim surface, easy to extend on first tsc failure). Fall back to copying real types if shim drift becomes painful.
2. **Lint scope including tests.** Sage recommends including tests with per-rule overrides if noise is high. Confirm or specify exclusions.
3. **Format choices.** Tabs vs spaces, line width, quote style — confirm Section 6.3.1's defaults or override.
4. **Tier-1.5 timing.** Hard-couple to TP-194 (same release) or allow gap? **Recommendation:** allow gap. The strictness ratchet is its own substantial work.
5. **Branch protection update.** Adding required status checks needs admin access to repo settings. Confirm willingness to flip these on the same PR-D release, or stage in a follow-up.

---

## 8. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Pi-shim drifts from real pi types over time | Medium | Document maintenance note in shim file. Surface on first tsc failure post-shim. Possible long-term: extract types from pi's `.d.ts`. |
| Format-PR rebase pain for in-flight work | Medium | Coordinated freeze window (Section 6.3.4). |
| Reviewer agent REVISEs on pre-existing errors | High if mis-sequenced; low with sequencing | PRs B and C clean baseline before PR D activates downgrade rule. |
| TP-194 surfaces typecheck errors in `main` not anticipated | High | TP-191 captures error count. TP-192/TP-193 address surface-level. If structural typecheck errors exist, scope adjusts before TP-194. |
| Strictness work (Tier-1.5) discovers cascading errors | Medium | Tier-1.5 timing allows post-TP-194 stabilization. Strictness PR can be scoped per-flag. |
| Biome config drift between PRs | Low | Single `biome.json`; pin Biome version in PR A. |
| `npx ...@latest` lingering in CI | Low | Removed in PR A by pinning. |

---

## 9. Tier-1.5 immediate follow-ups (referenced, not specified here)

### 9.1 TypeScript strictness ratchet (post-TP-194 follow-up)

**Sage's recommendation:** don't bundle with TP-194. After the gate flip is live, ratchet strictness in a dedicated effort.

**Approach options** (pick during strictness-ratchet PROMPT authoring):

- **One-shot strict PR.** Flip `strict: true` + all sub-flags. Fix every error. Large but conclusive.
- **Per-flag ratchet PRs.** `noImplicitAny` first, then `strictNullChecks`, then the rest. Each its own PR.

**Likely error surface:** unknown until TP-194 is live and `npm run typecheck` produces a clean baseline. Probe at strictness-ratchet PROMPT authoring time.

### 9.2 CHANGELOG fragment system (post-TP-194 follow-up)

**Problem:** every PR that touches `[Unreleased]` in `CHANGELOG.md` creates a merge conflict for every other in-flight PR. Hit this twice in May 2026 (TP-187/189 batch, then v0.29.0 release prep).

**Proposed approach:**

- New directory: `.changelog/` (or `changelog/unreleased/`).
- One file per change, named `<task-id>-<slug>.md` (e.g., `TP-187-supervisor-takeover.md`).
- File contents: a single CHANGELOG entry with section header (`### New` / `### Fixed` / etc.).
- Release script: at version-bump time, consolidate fragments into the new version's CHANGELOG section, delete the fragment files.

**Tools:** `changesets` is a popular off-the-shelf option. Alternative: a small Node script (~30 LOC) since our CHANGELOG format is custom.

**Out of scope for this spec.** Will get its own PROMPT.md when scheduled.

---

## 10. Tier-2 items (deferred but tracked)

**Explicitly listed** so they don't get lost. None are blockers for v0.30.0 or this work.

### 10.1 Test coverage tracking (c8)

> **Per user direction, this item is explicitly tracked here so it is not lost.**

- Add `c8` (Node native coverage) to dev dependencies.
- New scripts: `coverage`, `coverage:report`.
- CI optional step (advisory, doesn't gate).
- Report uploaded as PR artifact for inspection.
- Coverage gates (`coverage: 80%`) deferred to a future tier — visibility first, enforcement later.

**Rationale for deferral:** coverage is a separate concern from "make CI validate the code." Coverage without static analysis is misleading; static analysis without coverage is still valuable. Land static gates first; revisit coverage when the gate baseline is stable.

**When to revisit:** after the TS strictness work is complete. Coverage on weakly-typed code is less informative than coverage on strictly-typed code.

### 10.2 Pre-commit hooks

- Husky + lint-staged, OR a simple shell hook in `.git/hooks/pre-commit`.
- Run `lint`, `format:check`, optionally `typecheck` (slower) on staged files.
- Optional for developers (can be bypassed with `--no-verify` for emergencies).
- CI is still the authoritative gate.

**Rationale for deferral:** developer convenience, not correctness. CI catches the same issues; pre-commit just shifts when the developer learns about them.

### 10.3 TSDoc on public exports + `@internal` tag

- Document the public API surface (what consumers can import).
- Mark non-public exports with `@internal` JSDoc tag.
- Future tooling (api-extractor) can produce a public-API-tracking report.

**Rationale for deferral:** taskplane has no external programmatic consumers today. The pi extension API IS the public surface, and that's defined by pi, not us.

### 10.4 `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`

- Standard OSS hygiene.
- Easier for outside contributors.
- Reference AGENTS.md for AI-agent contribution patterns.

**Rationale for deferral:** static gates are higher-impact for code quality than process docs are.

### 10.5 Conventional commit enforcement (commitlint)

- We already practice conventional commits in this repo.
- `commitlint` would enforce the `<type>(<scope>): <subject>` shape.
- Foundation for future automated CHANGELOG generation.

**Rationale for deferral:** voluntary adherence is working. Hard enforcement adds friction without much marginal value today.

### 10.6 Renovate/Dependabot

- Almost no runtime deps (just `jiti`, `yaml`); peerDeps are pi-managed.
- Marginal benefit for a project with this dep profile.

**Rationale for deferral:** low signal-to-noise.

---

## 11. Validation summary

By the time TP-194 (the gate flip) ships:

- [ ] `npm run typecheck` exits 0 on `main`
- [ ] `npm run lint` exits 0 on `main`
- [ ] `npm run format:check` exits 0 on `main`
- [ ] All three are required status checks on `main` branch protection
- [ ] Reviewer agent on a synthetic regression task downgrades APPROVE → REVISE on a planted typecheck error
- [ ] Tests still pass: 3624+ passing, 0 failed
- [ ] AGENTS.md, release-process.md, development-setup.md all reference the new gates
- [ ] `.git-blame-ignore-revs` lists the format-adoption commit
- [ ] CHANGELOG entry under `[Unreleased]` for the v0.30.0 release

---

## 12. Sage consultation summary

Sage was consulted during spec design (2026-05-10). Key influences:

- **Don't bundle TS strictness with Tier-1.** Sage assessed all-at-once strict during the gate-flip work as high-risk; spec defers to a post-TP-194 follow-up.
- **Use dedicated shims, not test mocks** for pi-package module resolution in CI typecheck.
- **Promote CHANGELOG fragments to Tier-1.5.** Don't bury in Tier-2; high operational pain warrants near-term action.
- **Reviewer-agent activation requires baseline-green-first.** Otherwise reviewer REVISEs on pre-existing errors. Spec sequences PR B and PR C before PR D's downgrade activation.
- **Migrate `experimentalScannerIgnores` → `ignore`** while touching Biome config. Deprecated upstream.
- **Pin Biome and TypeScript versions.** Eliminates `npx ...@latest` drift in CI.
- **Include tests in scope** with per-rule overrides if noise is high.
- **Add `.git-blame-ignore-revs`** for the format-adoption commit.

Full sage transcript on file with the operator (turn-context).

---

## 13. Appendix: file inventory

Files added or modified across the rollout:

| PR | File | Type |
|---|---|---|
| A | `package.json` | Add `scripts` block + `devDependencies` |
| A | `extensions/types/pi-shims.d.ts` | NEW |
| A | `extensions/tsconfig.ci.json` | NEW |
| A | `extensions/tsconfig.test.json` | Modify (also map `@earendil-works/*`) |
| A | `biome.json` | Migrate `experimentalScannerIgnores` → `ignore`; expand scope |
| A | `.pi/taskplane-config.json` | Add typecheck/lint/format:check to testing.commands |
| A | `templates/agents/task-reviewer.md` | Activation note (temporary) |
| A | `.github/workflows/ci.yml` | Update lint step to use `npm run lint` (still `continue-on-error`) |
| B | (~5-10 source files) | Lint error fixes |
| C | (~50-80 source files) | Format-only diff |
| C | `.git-blame-ignore-revs` | NEW |
| C | `docs/maintainers/development-setup.md` | Document `git config blame.ignoreRevsFile` |
| D | `.github/workflows/ci.yml` | Remove `continue-on-error`; add typecheck + format:check jobs |
| D | `templates/agents/task-reviewer.md` | Remove activation note (downgrade rule active) |
| D | `AGENTS.md` | Add gates to validation checklist |
| D | `docs/maintainers/release-process.md` | Add gates to pre-release checklist |
| D | `docs/maintainers/development-setup.md` | Document gate commands |
| D | `CHANGELOG.md` | `[Unreleased]` entry (Internal section) |

---

**Status when spec is approved:** ready to author TP-191 through TP-194 PROMPT.md packets, in that order, for the orchestrator to execute as a sequence.
