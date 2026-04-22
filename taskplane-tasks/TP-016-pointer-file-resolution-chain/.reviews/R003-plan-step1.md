## Plan Review: Step 1: Implement Pointer Resolution

### Verdict: REVISE

### Summary
The Step 1 direction is correct, but the current outcomes are too underspecified for a shared resolver contract that will be consumed by task-runner, orchestrator, merge, and dashboard. The plan currently says “create `resolvePointer()`” and “return paths,” but it does not clearly lock in failure semantics or validation boundaries already established in Step 0 notes. Tightening those outcomes now will prevent divergent behavior in later steps.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:30-31` does not explicitly require non-fatal behavior for missing/malformed/unknown-repo pointers, even though Step 0 defines warn+fallback as the contract (`STATUS.md:154-156,161-162`). Given `extensions/taskplane/workspace.ts` is currently fail-fast for config file validation (`workspace.ts:99-110`), this omission creates implementation risk. Add an explicit Step 1 outcome that pointer resolution never throws for pointer-file failures and always returns fallback roots with warning metadata.
2. **[Severity: important]** — “Validates `config_repo` and `config_path` fields” is too vague as a reusable contract (`STATUS.md:30`). The plan should explicitly require: (a) repo ID lookup against workspace repo map, and (b) normalized/contained resolution for `config_path` so it cannot escape repo root via traversal. Without this, downstream callers can implement inconsistent “valid pointer” rules.
3. **[Severity: minor]** — Test intent is too narrow at plan level (`STATUS.md:61` only calls out unknown `config_repo`). Expand plan intent to cover missing pointer file, malformed JSON, and repo-mode ignore behavior so Step 5 verifies the full mode matrix (`STATUS.md:152-156`).

### Missing Items
- Explicit Step 1 outcome that pointer logic is workspace-only and ignored in repo mode.
- Explicit Step 1 outcome that state/sidecar root remains workspace `.pi/` while only config/agent roots may follow pointer.
- Explicit definition of what `resolvePointer()` returns on fallback (to keep Step 2–4 consumers consistent).

### Suggestions
- Add a small return contract (e.g., resolved roots + `usedPointer` flag + `warningReason`) to keep all callers deterministic.
- Keep pointer parsing centralized in `extensions/taskplane/workspace.ts` and avoid re-parsing pointer JSON in each subsystem.
