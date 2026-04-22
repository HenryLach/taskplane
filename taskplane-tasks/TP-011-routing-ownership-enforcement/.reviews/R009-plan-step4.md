# R009 — Plan Review (Step 4: Documentation & Delivery)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-011-routing-ownership-enforcement/PROMPT.md`
- `taskplane-tasks/TP-011-routing-ownership-enforcement/STATUS.md`
- `.pi/local/docs/taskplane/polyrepo-support-spec.md`
- `docs/reference/configuration/task-orchestrator.yaml.md`
- Prior review: `taskplane-tasks/TP-011-routing-ownership-enforcement/.reviews/R008-code-step3.md`

## Validation performed
- Confirmed Step 4 requirements in prompt (`PROMPT.md:84-99`)
- Confirmed current Step 4 plan content in status (`STATUS.md:85-92`)
- Checked docs for strict-routing coverage:
  - `.pi/local/docs/taskplane/polyrepo-support-spec.md` → no strict-routing/ownership policy content
  - `docs/reference/configuration/task-orchestrator.yaml.md` → no strict-routing config field
- Runtime verification for delivery gating:
  - `cd extensions && npx vitest run` ❌ (4 failed files, 3 failed tests, 1 failed suite)
  - `cd extensions && npx vitest run tests/discovery-routing.test.ts tests/workspace-config.test.ts` ✅ (145/145)
  - `node bin/taskplane.mjs help` ✅
  - `node bin/taskplane.mjs doctor` ❌ (exit 1; missing local .pi config files)

## Blocking findings

### 1) Step 4 is not hydrated into executable documentation/delivery work
Current Step 4 in `STATUS.md` is still prompt-level only:
- “Must Update docs modified”
- “Check If Affected docs reviewed”
- “Discoveries logged”
- “.DONE created”
- “Archive and push”

For Review Level 2, this needs concrete sub-tasks (target sections, exact edits, explicit acceptance evidence), similar to Steps 1–2 hydration quality.

### 2) The required “Must Update” documentation change is not planned at section level
`PROMPT.md` explicitly requires updating:
- `.pi/local/docs/taskplane/polyrepo-support-spec.md` with strict-mode behavior and team policy guidance.

Current plan does not specify:
- where the new content will live in that doc,
- what strict/permissive behavior matrix will be documented,
- how contributor remediation guidance (Execution Target requirements) will be captured,
- how the doc timestamp/version note will be updated.

### 3) “Check If Affected” review is not defined as a decision record
`PROMPT.md` requires reviewing `docs/reference/configuration/task-orchestrator.yaml.md` if public config is affected.

Given `routing.strict` is workspace-config-only (not in `task-orchestrator.yaml`), Step 4 should explicitly record a yes/no decision with rationale and evidence. The current plan has no decision criterion or logging format.

### 4) Delivery actions are planned without resolving Step 3 completion-contract blockers
Step 4 includes `.DONE` and archival/push actions, but Step 3 remains contractually unresolved:
- Prompt requires “ZERO test failures allowed” (`PROMPT.md:77`).
- Full suite is still red.
- `doctor` currently exits non-zero in this environment.

Step 4 plan must gate completion/delivery actions on explicit unblock criteria or blocker escalation, not proceed directly to closeout.

## Required updates before approval
1. Hydrate Step 4 in `STATUS.md` into concrete sub-steps with file-level granularity.
2. Add a documentation edit plan for `.pi/local/docs/taskplane/polyrepo-support-spec.md` with explicit section targets and required content points:
   - strict vs permissive routing behavior,
   - ownership declaration requirements,
   - remediation guidance,
   - recommended team policy.
3. Add an explicit “Check If Affected” decision record for `docs/reference/configuration/task-orchestrator.yaml.md` (updated vs not-updated + rationale).
4. Add Step 4 evidence capture fields (doc diff summary, commands run, exit codes, disposition).
5. Gate `.DONE` / archive / push behind completion criteria satisfaction (or explicitly mark blocked and escalate).

## Non-blocking note
Consider removing or conditioning “Archive and push” unless this task explicitly includes a user-approved git delivery action in this run.
