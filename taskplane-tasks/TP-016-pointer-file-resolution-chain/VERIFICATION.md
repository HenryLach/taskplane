# TP-016 Pointer File Resolution Chain — Step 5 Verification Log

**Date:** 2026-03-17
**Test suite:** `cd extensions && npx vitest run`
**Result:** 20 test files, 609 tests, all passing

## Pointer-Specific Test Coverage Matrix

### 1. `resolvePointer()` Unit Tests (workspace-config.test.ts §6.x)

| Test | Scenario | Expected | Status |
|------|----------|----------|--------|
| 6.1 | Repo mode (null workspaceConfig) | Returns null | ✅ |
| 6.2 | Missing pointer file | Fallback + warning | ✅ |
| 6.3 | Invalid JSON in pointer | Fallback + warning | ✅ |
| 6.4 | Pointer is not a JSON object | Fallback + warning | ✅ |
| 6.4b | Pointer is null JSON | Fallback + warning | ✅ |
| 6.5a | Missing config_repo field | Fallback + warning | ✅ |
| 6.5b | Missing config_path field | Fallback + warning | ✅ |
| 6.5c | Empty string config_repo | Fallback + warning | ✅ |
| 6.6 | Unknown config_repo (not in workspace repos) | Fallback + warning | ✅ |
| 6.7a | Traversal: config_path starts with `..` | Fallback + warning | ✅ |
| 6.7b | Traversal: `/../` in config_path | Fallback + warning | ✅ |
| 6.7c | Traversal: config_path ends with `/..` | Fallback + warning | ✅ |
| 6.8a | POSIX absolute config_path | Fallback + warning | ✅ |
| 6.8b | Windows absolute config_path (drive letter) | Fallback + warning | ✅ |
| 6.8c | Windows absolute config_path (forward slash drive) | Fallback + warning | ✅ |
| 6.9 | Valid pointer → resolved paths | configRoot + agentRoot set | ✅ |
| 6.9b | Nested subdirectory config_path | configRoot + agentRoot set | ✅ |
| 6.10 | Containment check (resolved path escapes repo) | Fallback + warning | ✅ |

### 2. Config Resolution with Pointer (project-config-loader.test.ts §5.x)

| Test | Scenario | Expected | Status |
|------|----------|----------|--------|
| 5.1 | Pointer configRoot used when cwd has no config | Config from pointer root | ✅ |
| 5.2 | cwd config takes precedence over pointer | cwd config wins | ✅ |
| 5.3 | Pointer takes precedence over TASKPLANE_WORKSPACE_ROOT | Pointer config wins | ✅ |
| 5.4 | Pointer without config files → falls through to wsRoot | wsRoot config used | ✅ |
| 5.5 | null/undefined pointerConfigRoot → pre-pointer behavior | No change | ✅ |
| 5.6 | Repo mode (no wsRoot, no pointer) | cwd or defaults | ✅ |
| 5.7 | loadConfig repo mode parity | No pointer interference | ✅ |
| 5.8 | loadConfig workspace mode with pointer | Pointer config resolved | ✅ |
| 5.9 | YAML config at pointer root | Resolved correctly | ✅ |
| 5.10 | Flat-layout JSON (no .pi/ subdir) | Found at pointer root | ✅ |
| 5.11 | Flat-layout YAML at pointer root | Found | ✅ |
| 5.12 | Flat-layout orchestrator YAML | Found | ✅ |
| 5.13 | Flat-layout pointer > TASKPLANE_WORKSPACE_ROOT | Pointer wins | ✅ |
| 5.14 | Standard layout (.pi/) preferred over flat | .pi/ layout wins | ✅ |
| 5.15 | Full precedence: cwd > pointer (flat) > wsRoot > defaults | Correct chain | ✅ |

### 3. Agent Resolution with Pointer (project-config-loader.test.ts §6.x)

| Test | Scenario | Expected | Status |
|------|----------|----------|--------|
| 6.1 | cwd/.pi/agents/ overrides pointer agentRoot | cwd wins | ✅ |
| 6.2 | cwd/agents/ (legacy) overrides pointer agentRoot | cwd wins | ✅ |
| 6.3 | Repo mode — pointer not consulted | No pointer interference | ✅ |

### 4. Pointer Warning Surfacing (project-config-loader.test.ts §6.4-6.6)

| Test | Scenario | Expected | Status |
|------|----------|----------|--------|
| 6.4 | No pointer warning when workspace config fails to load | No warning | ✅ |
| 6.5 | Pointer warning logged when workspace exists but pointer missing | Warning logged | ✅ |
| 6.6 | No pointer warning in repo mode | No warning | ✅ |

### 5. Orchestrator Pointer Threading (workspace-config.test.ts §7.x)

| Test | Scenario | Expected | Status |
|------|----------|----------|--------|
| 7.6 | spawnMergeAgent accepts agentRoot separate from stateRoot | Separate params | ✅ |
| 7.7 | Merge request/result files use stateRoot, not agentRoot | State at wsRoot | ✅ |
| 7.8 | executeOrchBatch threads agentRoot to mergeWaveByRepo | Threaded correctly | ✅ |
| 7.9 | extension.ts passes pointer.agentRoot to executeOrchBatch | Threaded correctly | ✅ |
| 7.10 | Pointer warning logged via console.error at startup | Warning emitted | ✅ |
| 7.11 | State operations use workspaceRoot, not pointer config | State at wsRoot | ✅ |
| 7.12 | orch and orch-resume derive stateRoot identically | Consistent behavior | ✅ |

## Integration Split Invariant

**Config/agent paths follow pointer:**
- `resolveConfigRoot()` → pointer configRoot in precedence chain (tests 5.1–5.15)
- `loadAgentDef()` → pointer agentRoot in precedence chain (tests 6.1–6.3)
- `spawnMergeAgent()` → pointer agentRoot for prompt (test 7.6)

**State paths stay at workspaceRoot/.pi/:**
- Batch state (`batchStatePath`) → uses repoRoot/wsRoot, not pointer (test 7.11)
- Merge request/result files → use stateRoot (test 7.7)
- `ORCH_SIDECAR_DIR` → `join(workspaceRoot, ".pi")` (test 7.11)
- Dashboard `REPO_ROOT` → unchanged, no pointer (verified in Step 4)
- Resume flow → identical stateRoot derivation (test 7.12)

## Repo-Mode Parity

All pointer logic is gated on workspace mode. Tests explicitly verify:
- `resolvePointer()` returns null in repo mode (test 6.1)
- Config resolution unchanged in repo mode (tests 5.5, 5.6, 5.7)
- Agent resolution unchanged in repo mode (test 6.3)
- No pointer warning in repo mode (test 6.6)
- Orchestrator state paths unchanged in repo mode (covered by existing pre-pointer tests)
