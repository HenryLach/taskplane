# Task-Runner Consolidation — Specification

**Status:** Ready for Implementation  
**Created:** 2026-04-10  
**Author:** Supervisor session  

---

## 1. Background and Motivation

Taskplane began as two separate pi extensions that users loaded together:

```bash
pi -e extensions/task-runner.ts -e extensions/task-orchestrator.ts
```

- **`task-runner.ts`** — provided `/task`, `/task-status`, `/task-pause`, `/task-resume` for single-task execution in the current working tree
- **`task-orchestrator.ts`** — a thin facade (~28 lines) over `extensions/taskplane/extension.ts`, providing all `/orch*` commands

These were designed for different eras. The `/task` command has since been removed entirely. Runtime V2 executes tasks through a completely different path:

```
/orch → engine.ts → execution.ts → lane-runner.ts → agent-host.ts
                                 → agent-bridge-extension.ts (worker subprocess)
```

`task-runner.ts` is no longer part of this path in any meaningful way. It is:
- Auto-loaded in every user's pi session via the `package.json` pi manifest
- ~2,784 lines, of which the ~1,448-line default export function is entirely dormant (no commands registered, `review_step` tool gated behind `isOrchestratedMode()` which is always false in the main session)
- Never imported by anything in `extensions/taskplane/`

The utility functions it contains (sidecar tail state, context window resolution) are the only live code — and they're only consumed by 3 test files via `_`-prefixed escape-hatch exports.

The relevant extraction has already begun: `extensions/taskplane/task-executor-core.ts` contains the core parsing functions (`parsePromptMd`, `parseStatusMd`, `generateStatusMd`, etc.) that were pulled out of `task-runner.ts`. `lane-runner.ts` imports from `task-executor-core.ts`, not from `task-runner.ts`.

This specification describes completing that extraction and deleting `task-runner.ts` entirely.

### Why now?

- There are no external users to protect — `task-runner.ts` was deprecated before Taskplane was public
- Keeping it loaded in every session wastes startup time and creates confusion
- It's a recurring source of architectural confusion (TP-160 reviewer model bug was partly a consequence of unclear module ownership)
- The 3 remaining live utilities deserve proper homes in the taskplane library

---

## 2. Current State Inventory

### 2.1 What task-runner.ts contains

| Category | Lines (approx) | Status |
|----------|---------------|--------|
| Imports and module-level setup | ~80 | Needed by live utilities |
| Config loading (`loadConfig`, `loadAgentDef`) | ~120 | Partially superseded by `config-loader.ts` |
| Sidecar telemetry utilities (`tailSidecarJsonl`, `createSidecarTailState`, `getSidecarDir`) | ~200 | **Live — used by 3 tests** |
| Context window utilities (`resolveContextWindow`, `FALLBACK_CONTEXT_WINDOW`) | ~80 | **Live — used by 3 tests** |
| Status/progress utilities (already in `task-executor-core.ts`) | ~300 | Duplicated — `task-executor-core.ts` is canonical |
| Worker/reviewer spawn loop (legacy execution engine) | ~400 | Dead — Runtime V2 uses `lane-runner.ts` |
| Dashboard widget and TUI components | ~200 | Dead in orchestrated mode |
| `default export function (pi)` — extension registration | ~1,448 | **Entirely dormant** |

### 2.2 What imports from task-runner.ts

**Direct imports (test files that import utilities):**

| Importer | What it uses |
|----------|-------------|
| `tests/context-pressure-cache.test.ts` | `_tailSidecarJsonl`, `_createSidecarTailState`, `_getSidecarDir`, `SidecarTailState`, `SidecarTelemetryDelta` |
| `tests/context-window-autodetect.test.ts` | `_resolveContextWindow`, `FALLBACK_CONTEXT_WINDOW` |
| `tests/context-window-resolution.test.ts` | `_resolveContextWindow`, `FALLBACK_CONTEXT_WINDOW` |
| `tests/project-config-loader.test.ts` | `loadConfig`, `_loadAgentDef`, `_resetPointerWarning` |
| `tests/task-runner-review-skip.test.ts` | `isLowRiskStep` (already in `task-executor-core.ts` — test just needs import update) |
| `tests/sidecar-tailing.test.ts` | Sidecar tail utilities |
| `extensions/taskplane/execution.ts` | `resolveTaskRunnerExtensionPath()` — **dead code, never called** |
| `package.json` pi manifest (`pi.extensions`) | Auto-loads as extension — **dead behavior** |
| `package.json` (`files`) | Listed explicitly — must be removed |

**Source-reading tests (will fail if file is deleted because they read task-runner.ts as source text):**

Several tests read source files via `readFileSync` to verify patterns (e.g., checking that certain guards exist). Any test that reads `task-runner.ts` as a source file will fail with ENOENT after deletion. A preflight inventory grep must identify all such tests before implementation begins.

Known/suspected source-reading tests: `crash-recovery-spawn-reliability.test.ts`, `mailbox.test.ts`, `persistent-*.test.ts`, `runtime-model-fallback.test.ts`, `task-runner-*.test.ts`. These must be audited — some may test behavior that no longer exists and can be deleted, others may need to point at the new module homes.

### 2.3 What task-runner.ts imports that needs a new home

The live utility functions depend on:
- `fs` (readFileSync, existsSync, etc.) — standard
- `path` (join, dirname) — standard
- `child_process` (spawn) — for reviewer spawning in legacy path
- Types: `SidecarTailState`, `SidecarTelemetryDelta` (defined in task-runner.ts itself)

---

## 3. Goals

1. **Delete `task-runner.ts`** — no shim, no re-exports, no compatibility wrapper. The creator is the sole user; there are no external consumers to protect.
2. **Move live utilities into proper `taskplane/` modules** — sidecar telemetry and context window utilities get named homes with clean exports.
3. **Update test files** to import from new locations.
4. **Remove from pi manifest** so new installs don't load a non-existent file.
5. **Remove dead references** — `resolveTaskRunnerExtensionPath()`, legacy `TASK_AUTOSTART` comments, dual-extension dev setup docs.
6. **Release as a minor version bump** (e.g. 0.25.x → 0.26.0) since removing a file from the package is a structural change even with no external consumers.

### Non-Goals

- Changing runtime behavior of any existing code
- Rewriting `task-executor-core.ts` (already correct)
- Touching `lane-runner.ts`, `agent-host.ts`, or `agent-bridge-extension.ts` beyond dead-reference cleanup
- Any behavior changes — this is a pure structural consolidation

---

## 4. New Module Layout

### 4.1 `extensions/taskplane/sidecar-telemetry.ts` (new)

Extract sidecar tail utilities from `task-runner.ts`. These are used by the dashboard and by tests verifying telemetry behavior.

**Exports:**
```typescript
export interface SidecarTailState { ... }
export interface SidecarTelemetryDelta { ... }
export function getSidecarDir(stateRoot: string, batchId: string, agentId: string): string
export function createSidecarTailState(path: string): SidecarTailState
export function tailSidecarJsonl(state: SidecarTailState): SidecarTelemetryDelta
```

**Note:** The `_`-prefixed escape hatches (`_tailSidecarJsonl` etc.) are not needed in the new module — the functions are exported directly.

### 4.2 `extensions/taskplane/context-window.ts` (new)

Extract context window resolution from `task-runner.ts`.

Note: the original signature takes `TaskConfig` (a task-runner internal type). The extracted version should accept only the fields it needs, avoiding a dependency on task-runner's `TaskConfig`.

**Exports:**
```typescript
export const FALLBACK_CONTEXT_WINDOW: number
export function resolveContextWindow(
    configuredWindow: number | undefined,  // was config.context.worker_context_window
    ctx: ExtensionContext | null,           // for auto-detecting from pi model registry
): { contextWindow: number; source: string }
```

### 4.3 Retain existing modules unchanged

- `extensions/taskplane/task-executor-core.ts` — already canonical, no changes needed
- `extensions/taskplane/lane-runner.ts` — already imports from `task-executor-core.ts`
- All other `extensions/taskplane/*.ts` files — untouched

---

## 5. Files Changed

| File | Action | Notes |
|------|--------|-------|
| `extensions/task-runner.ts` | **Delete** | The point of this whole exercise |
| `extensions/taskplane/sidecar-telemetry.ts` | **Create** | Extracted from task-runner.ts |
| `extensions/taskplane/context-window.ts` | **Create** | Extracted from task-runner.ts |
| `extensions/tests/context-pressure-cache.test.ts` | Update imports | Point to `../taskplane/sidecar-telemetry.ts` |
| `extensions/tests/context-window-autodetect.test.ts` | Update imports | Point to `../taskplane/context-window.ts` |
| `extensions/tests/context-window-resolution.test.ts` | Update imports | Point to `../taskplane/context-window.ts` |
| `extensions/tests/project-config-loader.test.ts` | Update imports | `loadConfig` → `config-loader.ts`; `_loadAgentDef` → `execution.ts` (exported alongside `loadBaseAgentPrompt`) |
| `extensions/tests/task-runner-review-skip.test.ts` | Update imports | `isLowRiskStep` → `../taskplane/task-executor-core.ts` |
| `extensions/tests/sidecar-tailing.test.ts` | Update imports | Point to `../taskplane/sidecar-telemetry.ts` |
| `extensions/tests/task-runner-*.test.ts` and others | Audit → update or delete | Source-reading tests may be testing dead behavior; see Section 8 Q3 |
| `extensions/taskplane/execution.ts` | Remove dead code + add export | Delete `resolveTaskRunnerExtensionPath()`; export `loadAgentDef` for test use |
| `package.json` | Remove from BOTH `"pi".extensions` AND `"files"` | Two separate entries need removal |
| `extensions/task-orchestrator.ts` | Update comment | Remove dual-extension loading reference |
| `docs/maintainers/development-setup.md` | Update | Remove `pi -e extensions/task-runner.ts` instructions |
| `docs/maintainers/package-layout.md` | Update | Remove task-runner.ts from package layout description |
| `docs/explanation/architecture.md` | Update | Remove any remaining task-runner module description |
| `AGENTS.md` | Update | Remove task-runner.ts loading reference |
| `templates/agents/task-worker.md` | Audit | Remove any task-runner-specific language |
| `bin/taskplane.mjs` | Audit | Remove any `/task and /orch are ready` style messaging |

### Files NOT changed

- `extensions/taskplane/task-executor-core.ts` — already correct
- `extensions/taskplane/lane-runner.ts` — doesn't import task-runner.ts
- `extensions/taskplane/agent-bridge-extension.ts` — doesn't import task-runner.ts
- All other `extensions/taskplane/*.ts` — don't import task-runner.ts
- All test files except the 3 listed above

---

## 6. Migration Steps (Proposed Task Breakdown)

### Step 0: Preflight — full reference inventory (blocking)

Before writing any code, run a comprehensive grep audit to find **every** reference to `task-runner.ts`:

1. Direct imports in test files: `grep -rn "from.*task-runner" extensions/tests/`
2. Source-reading references: `grep -rn "task-runner.ts" extensions/tests/` (tests that read it as text via readFileSync)
3. Docs and templates: `grep -rn "task-runner" docs/ templates/ AGENTS.md`
4. Package manifests: verify both `package.json["pi"]["extensions"]` and `package.json["files"]`
5. For each source-reading test: determine if it tests live behavior (update) or dead behavior (delete)

Produce a complete checklist of all references before proceeding. This step is blocking — implementation should not begin until the inventory is complete.

### Step 1: Create new modules with verbatim extraction

1. Read `task-runner.ts` and identify the **exact** code and signatures for `SidecarTailState`, `SidecarTelemetryDelta`, `getSidecarDir`, `createSidecarTailState`, `tailSidecarJsonl` — copy verbatim into `sidecar-telemetry.ts`. Export directly without `_` prefix. Do **not** change signatures.
2. Read `task-runner.ts` and identify **exact** `FALLBACK_CONTEXT_WINDOW` and `resolveContextWindow` — copy verbatim into `context-window.ts`. If `resolveContextWindow` depends on task-runner.ts internal state (`state.*`), document this in the Discoveries table and adapt the signature minimally.
3. Check whether `getSidecarDir` or similar already exists in `execution.ts` or `lane-runner.ts` — consolidate if so, don't duplicate.
4. Update ALL test files identified in Step 0 (not just 3 — may be 6+)
5. Run full test suite — all tests must pass before proceeding

### Step 2: Remove from pi manifest and extension loading

1. Remove `"./extensions/task-runner.ts"` from `package.json` `"pi".extensions`
2. Verify `task-orchestrator.ts` comment no longer references loading both
3. Verify `AGENTS.md` and `docs/maintainers/development-setup.md` don't tell users to load `task-runner.ts`

### Step 3: Remove dead code and delete task-runner.ts

1. Delete `resolveTaskRunnerExtensionPath()` from `execution.ts` (it's private and never called)
2. Clean up comments in `execution.ts` that reference TASK_AUTOSTART and legacy session path (the comments, not the code — the code was already removed in Runtime V2)
3. **Delete `extensions/task-runner.ts`**
4. Run full test suite — verify nothing broke

### Step 4: Verify and release

1. Run `node bin/taskplane.mjs doctor` — should still pass
2. Run `node bin/taskplane.mjs init --preset full --dry-run` — should still work
3. Bump minor version to 0.26.0
4. Publish to npm

---

## 7. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| **More test files import task-runner.ts than inventoried** | **High** | **Step 0 mandatory preflight inventory; do not skip** |
| **Source-reading tests fail with ENOENT after deletion** | **High** | **Identify all readFileSync refs in Step 0; update or delete each test** |
| Sidecar/context utility behavior changes during extraction | Medium | Copy verbatim; document any signature adaptations explicitly; tests provide regression coverage |
| `resolveContextWindow` has hidden dependencies on task-runner.ts internal state | Medium | Read full function carefully; if it depends on `state.*`, adapt minimally and document |
| pi manifest change breaks existing installs on upgrade | None | npm replaces the entire package on upgrade; old file is removed automatically |
| Missed `package.json["files"]` entry (separate from pi manifest) | Low | Sage identified this; both entries are in the files-changed list |
| Docs/templates still reference task-runner after deletion | Low | Expanded docs scope in files-changed table; CI link checker will catch broken refs |
| Some legacy agent session path still references task-runner.ts via TASK_AUTOSTART env var | Low | Runtime V2 exclusively uses subprocess backend; TASK_AUTOSTART is never set |

---

## 8. Open Questions — Resolution

All questions have been answered before task creation. Tasks can proceed directly to implementation.

1. **How many test files actually import or read task-runner.ts?** ❓ **Step 0 will answer this.** The Step 0 preflight grep is specifically designed to produce the definitive list. Do not skip it.

2. **Does `resolveContextWindow` depend on any task-runner.ts internal state?** ✅ **Answered.** The function signature is `resolveContextWindow(config: TaskConfig, ctx: ExtensionContext)` — no `state.*` access. It is extractable, but `TaskConfig` is a task-runner internal type. The extracted version should accept the subset of fields it actually uses (just `config.context.worker_context_window` and `ctx.model?.contextWindow`) rather than importing the full `TaskConfig` type. This is a minimal, safe signature adaptation — document it in the task.

3. **Which source-reading tests test dead behavior vs. live behavior?** ❓ **Step 0 will answer this.** Worker must audit each source-reading test individually during preflight.

4. **Is `getSidecarDir` or equivalent already in the taskplane library?** ✅ **Answered.** Not present in `execution.ts` or `lane-runner.ts`. Safe to extract without duplication.

5. **Should `sidecar-telemetry.ts` and `context-window.ts` be one file or two?** ✅ **Decision: two files.** They are conceptually unrelated: sidecar utilities only touch `fs`/`path`, while `resolveContextWindow` depends on `ExtensionContext` from pi. Combining them would create an odd import graph. Keep them separate.

6. **Does `_loadAgentDef` belong in `execution.ts` or a new `agent-resolution.ts`?** ✅ **Decision: export from `execution.ts`.** `loadAgentDef` is functionally related to `loadBaseAgentPrompt` and `loadLocalAgentPrompt` which already live in `execution.ts`. Same concern area, no new file needed. The function returns `{ systemPrompt, tools, model }` parsed from agent frontmatter — export it alongside the existing agent prompt loaders.

---

## 9. Relationship to Other Work

| Work | Relationship |
|------|-------------|
| TP-157 (path-resolver.ts) | Completed — no overlap with task-runner.ts |
| TP-160 (reviewer model threading) | **Do TP-160 first.** It modifies `execution.ts` and `agent-bridge-extension.ts`. This consolidation also touches `execution.ts`. Sequencing avoids conflicts. |
| TP-159 (ghost worker detection) | Completed or in-progress — touches `execution.ts` in different locations. No conflict. |
| Future work | After this consolidation, `task-orchestrator.ts` becomes the only user-loaded extension. Consider whether it should be renamed or if its 28-line facade should be inlined directly. |
