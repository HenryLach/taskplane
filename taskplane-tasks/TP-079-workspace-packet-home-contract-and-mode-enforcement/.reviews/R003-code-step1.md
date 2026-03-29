# R003 — Code Review (Step 1: Add packet-home routing contract)

## Verdict
**APPROVE** — implementation meets Step 1 requirements with good validation coverage and deterministic behavior.

## Review scope
- Prompt/Status context reviewed
- Baseline diff commands executed exactly as requested:
  - `git diff 8f85b2ec906b16d3d372fed90fe8f51c17a5e4e6..HEAD --name-only`
  - `git diff 8f85b2ec906b16d3d372fed90fe8f51c17a5e4e6..HEAD`
- Note: baseline commit currently equals `HEAD`, so that range is empty in this lane. I additionally reviewed the working-tree changes against the baseline to evaluate Step 1 implementation.

## What is correct

1. **Routing contract added to workspace types**
   - `WorkspaceRoutingConfig` now includes `taskPacketRepo` with explicit contract docs.
   - New workspace error codes are added to `WorkspaceConfigErrorCode` for:
     - unknown packet-home repo
     - tasks root escaping packet-home repo
     - task-area escaping tasks root

2. **Workspace YAML validation enforces packet-home invariants**
   - `loadWorkspaceConfig()` now:
     - reads/validates `routing.task_packet_repo`
     - applies deterministic compatibility fallback to `default_repo` when missing
     - validates repo ID existence with actionable “Available repos” message
     - enforces `tasks_root` containment under packet-home repo

3. **Cross-config invariant is enforced in the right place**
   - New `validateTaskAreasWithinTasksRoot()` is executed from `buildExecutionContext()` after task-runner config is loaded.
   - This matches architecture reality (task areas are not available during workspace YAML-only parsing).

4. **Tests cover required behavior**
   - New `tests/packet-home-contract.test.ts` covers:
     - explicit + fallback packet-home parsing
     - unknown packet-home repo error
     - tasks root containment failure
     - task-area containment failure + success case
   - Existing workspace integration tests were adjusted so `tasks_root` is valid under repo ownership.

## Validation run
- Ran:
  - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/packet-home-contract.test.ts tests/workspace-config.integration.test.ts`
- Result: **pass** (100 tests, 0 failures).

## Non-blocking notes
- Compatibility fallback currently logs via `console.error`; consider `console.warn` (or centralized warning channel) to reduce stderr noise while keeping migration guidance visible.
- There are still typed test fixtures elsewhere in the repo that construct `WorkspaceRoutingConfig` without `taskPacketRepo` (often via `as any`/partial shapes). Not blocking for runtime, but worth normalizing in follow-up for contract consistency.
