# R003 — Plan Review (Step 1: Enforce policy during discovery)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-011-routing-ownership-enforcement/PROMPT.md`
- `taskplane-tasks/TP-011-routing-ownership-enforcement/STATUS.md`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/messages.ts`
- `extensions/taskplane/workspace.ts`
- `extensions/tests/discovery-routing.test.ts`
- `extensions/tests/workspace-config.test.ts`

## Blocking findings

### 1) Step 1 is not hydrated into implementation-level work
`STATUS.md` Step 1 still has only prompt-level bullets (`STATUS.md:32-33`).

Please expand Step 1 into concrete checklist items (file-level edits + verification tasks), similar to Step 0 hydration quality.

### 2) Plan/status state is internally inconsistent
Top-level status says `✅ Complete` (`STATUS.md:4`), while Step 1 itself is `🟨 In Progress` (`STATUS.md:30`).

Before implementation continues, normalize this so reviewers/operators can trust task state.

### 3) Plan does not distinguish “already implemented” vs “remaining Step 1 delta”
Core Step 1 behavior appears already present in code:
- strict enforcement in workspace-mode discovery routing (`extensions/taskplane/discovery.ts`, `resolveTaskRouting()`)
- routing stage wired into discovery pipeline (`runDiscovery()` Step 6, workspace-only)
- remediation text embedded in `TASK_ROUTING_STRICT` error message

The plan must explicitly state whether Step 1 is now:
- a **verification-only** step (no new runtime behavior), or
- a **delta implementation** step (and what exact behavior is missing).

Without this, there is high risk of redundant edits/scope drift.

### 4) Contributor remediation UX path is not explicitly planned
If Step 1 intends additional contributor-facing guidance beyond the discovery error body, the plan should say where it will live and how consistency is maintained.

Current command-level post-fatal hints in `/orch-plan` and `/orch` special-case only:
- `TASK_REPO_UNRESOLVED`
- `TASK_REPO_UNKNOWN`

(`extensions/taskplane/extension.ts`, `extensions/taskplane/engine.ts`)

If no extra command-level hint is intended for `TASK_ROUTING_STRICT`, document that decision explicitly in the Step 1 plan.

## Required plan updates before implementation
1. Hydrate Step 1 in `STATUS.md` into concrete sub-tasks (code and/or verification tasks).
2. Resolve status inconsistency (`Complete` vs `In Progress`).
3. Declare Step 1 scope explicitly: verification-only vs new behavior delta.
4. Add an explicit Step 1 validation matrix (reuse existing tests where applicable), at minimum:
   - workspace strict mode fatal behavior,
   - remediation text visibility,
   - repo-mode non-regression.
5. If command-surface guidance is in scope, specify message source (prefer centralized template in `messages.ts`) and tests.

## Non-blocking note
`routing.strict` currently parses fail-open (`rawStrict === true`) in `extensions/taskplane/workspace.ts`. If strict governance is expected to be robust against config typos, track/plan explicit type validation soon (if not in this step, add as a logged follow-up).
