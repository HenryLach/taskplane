# Task: TP-157 - Consolidate npm/package path resolution into path-resolver.ts

**Created:** 2026-04-10
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Cross-cutting refactor touching three runtime files. Pattern novelty is low (extracting existing logic), but correctness is high-stakes — a broken resolver silently skips reviews or fails to spawn workers on any platform. Cross-platform correctness (Windows, macOS, Linux) is the core requirement.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-157-path-resolver-utility/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Create `extensions/taskplane/path-resolver.ts` — a single shared module that owns all npm global root detection and package/tool path resolution. Eliminate the three duplicate implementations currently spread across `execution.ts`, `agent-host.ts`, and `agent-bridge-extension.ts`.

This task was identified by Sage after a series of macOS-specific bugs (#472, #474) caused by hardcoded path lists that missed Homebrew (`/opt/homebrew`) and contained ESM-unsafe `require()` calls. Each fix had to be applied to multiple files, and future drift risks regressions.

**Critical requirement: the resolver must work correctly on all three platforms:**
- **Windows** — npm global root is typically `%APPDATA%\npm\node_modules` or a custom prefix; no `/usr/local` or `/opt/homebrew`
- **macOS** — multiple valid npm setups: system Node (`/usr/local`), Homebrew (`/opt/homebrew`), nvm (`~/.nvm/versions/node/<ver>/lib`), volta (`~/.volta`), custom prefix (`~/.npm-global`)
- **Linux** — system (`/usr/local`), custom prefix (`~/.npm-global`), nvm, volta

The `npm root -g` dynamic call must be the **primary** resolution path (covers all setups) with static fallbacks for environments where `npm` isn't on PATH.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/execution.ts` — `getNpmGlobalRoot()`, `resolveTaskplanePackageFile()`, `loadBaseAgentPrompt()` (lines ~22-160 and ~2128-2145)
- `extensions/taskplane/agent-host.ts` — `getNpmGlobalRoot()`, `resolvePiCliPath()` (lines ~23-105)
- `extensions/taskplane/agent-bridge-extension.ts` — `getNpmGlobalRoot()`, `resolvePiCli()`, `loadReviewerPrompt()` (lines ~28-430)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/path-resolver.ts` ← new file
- `extensions/taskplane/execution.ts` ← replace local functions with imports
- `extensions/taskplane/agent-host.ts` ← replace local functions with imports
- `extensions/taskplane/agent-bridge-extension.ts` ← replace local functions with imports

## Steps

### Step 0: Preflight

- [ ] Read all three source files and catalog every path resolution function (name, location, what it resolves, caching behavior, platform gaps)
- [ ] Verify test suite baseline: `cd extensions && npm test` (or `npm run test:fast`)

### Step 1: Create extensions/taskplane/path-resolver.ts

Create the new module. It must export:

#### `getNpmGlobalRoot(): string`
- Calls `npm root -g` via `spawnSync` (ESM-safe — import `spawnSync` from `"child_process"`, never use `require()`)
- Caches result at module level (called frequently, always same answer per process)
- Returns `""` on failure — never throws
- `shell: true` is required for Windows where `npm` is a `.cmd` file

#### `resolvePiCliPath(): string`
- Finds `@mariozechner/pi-coding-agent/dist/cli.js` in the global npm install
- Resolution order:
  1. `npm root -g` result (dynamic — covers ALL setups)
  2. `%APPDATA%\npm\node_modules\...` (Windows)
  3. `~\AppData\Roaming\npm\node_modules\...` (Windows alt)
  4. `~/.npm-global/lib/node_modules/...` (macOS/Linux custom prefix)
  5. `/usr/local/lib/node_modules/...` (macOS system Node, Linux)
  6. `/opt/homebrew/lib/node_modules/...` (macOS Homebrew)
- Throws a clear error if not found, including the npm root in the message for diagnosis

#### `resolveTaskplanePackageFile(repoRoot: string, relPath: string): string`
- Finds a file within the taskplane npm package (e.g., `"templates/agents/task-worker.md"`, `"extensions/task-runner.ts"`)
- Resolution order:
  1. `join(repoRoot, relPath)` — local development (taskplane's own repo)
  2. `npm root -g` result (dynamic)
  3. Static fallbacks (same list as above)
  4. Peer of pi's package (look adjacent to `process.argv[1]`)
- Returns the local path as fallback (will fail at use site with clear error)

#### `resolveTaskplaneAgentTemplate(agentName: string): string`
- Convenience wrapper: calls `resolveTaskplanePackageFile(cwd, join("templates", "agents", agentName + ".md"))`
- Used by `loadBaseAgentPrompt` and `loadReviewerPrompt`

**Important implementation notes:**
- All functions must be ESM-safe — `import { spawnSync } from "child_process"`, never `require()`
- `getNpmGlobalRoot()` must be module-level cached — it is called from multiple callsites per process, including inside reviewer subprocess callbacks
- `shell: true` on the `spawnSync("npm", ...)` call is mandatory for Windows compatibility
- No silent swallowing of resolution failure — the error message should tell the user exactly what was searched and what `npm root -g` returned
- Add JSDoc to all exports with platform notes

### Step 2: Refactor callers to use path-resolver.ts

Replace the local implementations in all three files:

- [ ] **`execution.ts`**: Remove `getNpmGlobalRoot()`, `resolveTaskplanePackageFile()`. Update `loadBaseAgentPrompt()` to call `resolveTaskplaneAgentTemplate()`. Update `resolveTaskRunnerExtensionPath()` to call `resolveTaskplanePackageFile()`. Import from `./path-resolver.ts`.
- [ ] **`agent-host.ts`**: Remove `getNpmGlobalRoot()`, `_npmGlobalRootCache`, `resolvePiCliPath()`. Import `resolvePiCliPath` from `./path-resolver.ts`. Verify the exported function signature is compatible (it's used externally).
- [ ] **`agent-bridge-extension.ts`**: Remove `_npmRootCache`, `getNpmGlobalRoot()`, `resolvePiCli()`, `loadReviewerPrompt()`. Import `resolvePiCliPath` and `resolveTaskplaneAgentTemplate` from `./path-resolver.ts`. Update `loadReviewerPrompt` to use `resolveTaskplaneAgentTemplate("task-reviewer")` for the base template path.
- [ ] Verify no other files import the removed functions directly

### Step 3: Testing & Verification

- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke checks: `node bin/taskplane.mjs help && node bin/taskplane.mjs version && node bin/taskplane.mjs init --preset full --dry-run --force`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Add a JSDoc file header to `path-resolver.ts` explaining the platform coverage rationale
- [ ] Update `AGENTS.md` or relevant docs if there's a note about path resolution (search for "resolvePiCliPath" or similar)
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/path-resolver.ts` — thorough JSDoc (this is the source of truth for how resolution works)

**Check If Affected:**
- `AGENTS.md` — if it references path resolution or platform setup
- `docs/maintainers/development-setup.md` — if it references how agents are spawned

## Completion Criteria

- [ ] All steps complete
- [ ] `path-resolver.ts` exists with all four exports
- [ ] All three source files import from `path-resolver.ts` — no local duplicates remain
- [ ] No `require("child_process")` calls anywhere in the refactored files
- [ ] Full test suite passing
- [ ] CLI smoke checks passing

## Git Commit Convention

- **Step completion:** `refactor(TP-157): complete Step N — description`
- **New file:** `refactor(TP-157): add path-resolver.ts`
- **Bug fixes:** `fix(TP-157): description`
- **Tests:** `test(TP-157): description`
- **Hydration:** `hydrate: TP-157 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Change resolution behavior — this is a pure refactor; the logic should be identical to what each file currently has (post #472/#474 fixes), just consolidated
- Use `require()` anywhere — this is an ESM codebase
- Modify the public API of `resolvePiCliPath` — it's exported from `agent-host.ts` and used externally
- Skip any of the three caller files — the whole point is eliminating all duplicates
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
