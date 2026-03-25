# R001 — Plan Review (Step 1: Post-Integrate Cleanup / Layer 1)

## Verdict
**Changes requested** — the Step 1 direction is close, but the plan is missing critical scoping details for workspace mode and safety gating.

## Reviewed artifacts
- `taskplane-tasks/TP-065-artifact-cleanup-and-rotation/PROMPT.md`
- `taskplane-tasks/TP-065-artifact-cleanup-and-rotation/STATUS.md`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/cleanup.ts`

## Blocking findings

### 1) State-root selection is underspecified (repo root vs workspace root)
Step 1 cleanup must operate where artifacts are actually written.

- Telemetry is generated under `sidecarRoot/.pi/telemetry` (workspace-aware) (`execution.ts:152-188`).
- Merge result files are written under `stateRoot/.pi/` (`merge.ts:1229-1233`).
- Existing `/orch-status` disk reads use `stateRoot = workspaceRoot ?? repoRoot` (`extension.ts:1752-1756`).

But the current Step 1 wiring path resolves integration state/cleanup off `repoRoot` (`extension.ts:2112-2115`, `extension.ts:2297`, `extension.ts:985`).

**Why this blocks:** in workspace mode, Layer 1 may miss artifacts (or read the wrong batch-state), violating deterministic cleanup.

**Required plan update:** explicitly define a single `stateRoot` contract for Step 1 (matching engine/state persistence semantics) and use it for batch-state read + artifact cleanup.

---

### 2) Safety gate must be explicit for cleanup entrypoints
PROMPT requires: never delete unless batch phase is `completed`.

`resolveIntegrationContext` enforces phase gating when state is loaded (`extension.ts:234-248`), but Step 1 plan does not explicitly state that cleanup must be downstream of this gate for **all** execution paths.

**Why this blocks:** cleanup helper reuse (manual integrate, tool integrate, supervisor executor) can drift unless phase-gate dependency is explicit.

**Required plan update:** state in Step 1 plan that cleanup is only callable after successful integration context resolution for a completed batch (or equivalent completed-phase proof).

---

### 3) Deletion scope needs tighter contract to avoid accidental overreach
Prompt Step 1 defines specific deletion targets. Current cleanup helper also targets merge-request artifacts and globally deletes all `lane-prompt-*.txt` files (`cleanup.ts:47-50`, `cleanup.ts:83-89`, `cleanup.ts:105-108`).

**Why this blocks:** this expands behavior beyond Step 1 requirements and raises risk during edge flows unless intentionally documented.

**Required plan update:** for Step 1, explicitly enumerate exact file classes to delete and why each is safe. If retaining extra classes (e.g., merge-request files), call out as intentional scope expansion and justify.

## Required plan updates before implementation sign-off
1. Add explicit `stateRoot` decision for Step 1 (workspace-compatible).
2. Add explicit completed-phase gating rule for every cleanup invocation path.
3. Lock the Layer 1 deletion allowlist to PROMPT scope (or document intentional expansion).
4. Add a mini Step 1 test matrix in STATUS now (to execute in Step 4):
   - matching/non-matching batchId files,
   - workspace-root cleanup path,
   - non-completed batch guard,
   - non-fatal deletion failure handling + user-visible summary.

## Non-blocking notes
- `STATUS.md` currently says Step 1 is complete and current step is Step 2 (`STATUS.md:3`, `STATUS.md:22-27`), while this request is a Step 1 plan review; keep status/review sequencing aligned.
- Keep user-facing cleanup summary wording close to PROMPT language (telemetry + merge result counts + batchId) for operator clarity.
