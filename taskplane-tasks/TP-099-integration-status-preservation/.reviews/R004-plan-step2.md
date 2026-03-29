# R004 — Plan Review (Step 2: Implement STATUS.md preservation)

## Verdict
**REVISE**

## What I reviewed
- `taskplane-tasks/TP-099-integration-status-preservation/PROMPT.md`
- `taskplane-tasks/TP-099-integration-status-preservation/STATUS.md` (current Step 2 plan)
- `extensions/taskplane/merge.ts` (artifact staging block)
- `extensions/taskplane/execution.ts` (`commitTaskArtifacts` behavior)
- `extensions/tests/status-reconciliation.test.ts` (TP-035 allowlist contract)

## Blocking findings

1. **Backfill source selection is still under-specified (determinism risk).**
   The plan says for missing `destPath`, use `join(lane.worktreePath, relPath)` as primary source, but does not define how `relPath` maps to a specific lane. In implementation this can become ambiguous/nondeterministic when multiple lanes exist.

   **Required fix in plan:** define a deterministic mapping when building candidates (e.g., `Map<relPath, laneWorktreePath[]>` in merge order), then resolve in stable order and pick first existing + contained source.

2. **`.reviews/` preservation requirement is not explicitly traced to mechanism.**
   Prompt requirements include preserving reviews/discoveries and Step 3 explicitly calls out `.reviews/` survival. Current plan correctly keeps TP-035 allowlist unchanged, but does not explicitly explain how `.reviews/` are preserved under that constraint.

   **Required fix in plan:** add an explicit statement that `.reviews/` are expected to survive via normal lane-branch merge (not artifact backfill allowlist), and that this change must avoid any overwrite/delete behavior that could regress that path.

## Non-blocking suggestions

- In the algorithm text, explicitly require containment checks for **both** sources:
  - lane source under `lane.worktreePath`
  - fallback source under `repoRoot`
- Keep the commit guard explicit: commit only when `git add` staged at least one path.

## Summary
The core direction is now correct (no overwrite of existing merged artifacts, backfill only missing files, TP-035 allowlist unchanged). After clarifying deterministic per-path source resolution and explicit `.reviews/` preservation semantics, this plan should be implementation-ready.