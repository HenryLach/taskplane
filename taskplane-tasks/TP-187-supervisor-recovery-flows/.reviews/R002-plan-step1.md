## Plan Review: Step 1: Plan all three sub-fix designs

### Verdict: REVISE

### Summary
The Step 1 plan is substantially improved from R001: the #538 zombie-alert suppression lifecycle is now clearly scoped across lane respawn, `orch_resume`, and batch boundaries, and the tool-surface placement is internally consistent. The #540 design is also concrete and implementable with a clear fallback path. However, the #539 design currently downgrades from “reconstruct and relaunch when possible” to “always fail loudly with guidance,” which does not satisfy the intended recovery outcome of this task.

### Issues Found
1. **[Severity: important]** — The #539 plan explicitly rejects disk reconstruction and instead always returns an improved error when `.pi/batch-state.json` is missing (STATUS.md, “Design #539 — Reconstruction policy: prefer fail-loud over partial reconstruction”). This conflicts with the task’s required outcome to make `orch_resume(force=true)` reattach after `orch_abort()` when recoverable on-disk runtime state exists (PROMPT.md File Scope + Step 3 first checkbox). **Suggested fix:** keep fail-loud as fallback, but plan a minimal deterministic reconstruction path (e.g., recover latest batchId from history/runtime dir, rebuild enough batch metadata/lane assignment from persisted runtime artifacts, then resume). Only emit the new `orch_start` guidance when required reconstruction inputs are absent/corrupt.

### Missing Items
- A concrete “reconstruct-when-possible” design for #539, including minimum required artifacts and explicit fallback criteria to the fail-loud message.

### Suggestions
- Define reconstruction strictness up front (required vs optional artifacts) to keep behavior deterministic and avoid silent partial resumes.
