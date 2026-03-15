# R009 — Plan Review (Step 4: Documentation & Delivery)

## Verdict
**Changes requested**

## What I reviewed
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/PROMPT.md`
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/STATUS.md`
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/.reviews/R008-code-step3.md`
- `extensions/taskplane/messages.ts`

## Findings

### 1) **Blocking**: Step 4 plan is not hydrated for Review Level 3
`STATUS.md` Step 4 is still only five coarse checkboxes (`STATUS.md:140-144`).
For this task size/blast radius, the plan must be concrete and file-level (what exact sections/contract deltas will be documented, how “check if affected” is decided, and what evidence is recorded).

### 2) **Blocking**: Prompt-mandated docs updates are not operationalized
Prompt requires:
- Must update: `.pi/local/docs/taskplane/polyrepo-support-spec.md` (`PROMPT.md:99-100`)
- Check if affected: `extensions/taskplane/messages.ts` (`PROMPT.md:102-103`)

Current Step 4 plan does not define:
- which lane/worktree contract changes from TP-004 will be written into the spec,
- what review method will be used for `messages.ts` (and what “affected” means),
- how the decision/rationale will be captured in `STATUS.md`.

### 3) **Blocking**: Step 4 completion gate conflicts with unresolved Step 3 quality gate
Prompt requires zero failures / all tests passing (`PROMPT.md:82`, `PROMPT.md:108`).
But STATUS still records full-suite failures while marking Step 3 complete (`STATUS.md:130`), and R008 is still effectively unresolved (`.reviews/R008-code-step3.md` verdict: `changes-requested`).

Step 4 plan must include a hard gate before `.DONE` that reconciles this (fix failures or explicitly record blocker/disposition).

### 4) **Major**: Delivery lifecycle drift from prompt contract
Prompt says archive is auto-handled by task-runner (`PROMPT.md:95`), but STATUS has manual `Archive and push` (`STATUS.md:144`).
This is out of contract and should be removed/replaced with prompt-aligned completion checks.

### 5) **Major**: Status metadata is internally inconsistent
Top-level STATUS says `**Status:** ✅ Complete` while current step is Step 4 in progress (`STATUS.md:3-4`, `STATUS.md:138`).
Plan should include metadata cleanup as part of delivery hygiene.

## Required updates before approval
1. Hydrate Step 4 into concrete sub-items (4.1/4.2/4.3...) with explicit file actions and evidence capture.
2. Add a specific doc-update plan for `.pi/local/docs/taskplane/polyrepo-support-spec.md` covering finalized TP-004 contracts:
   - repo-aware lane identity format (`laneId`, `tmuxSessionName`, `laneNumber` uniqueness),
   - repo-scoped worktree provisioning/reset/remove behavior,
   - deterministic ordering + rollback semantics,
   - repo-mode backward compatibility.
3. Add an explicit `messages.ts` review item with deterministic decision output: changed/not changed + rationale logged in STATUS.
4. Replace `Archive and push` with prompt-aligned completion items (`discoveries logged`, `.DONE` creation; archive auto).
5. Add a pre-`.DONE` quality gate that resolves the Step 3/R008 test-failure contradiction.
6. Fix STATUS header/step status consistency while touching Step 4.

## Note
In this worktree, `.pi/local/docs/...` is not present (likely local/gitignored). Step 4 plan should explicitly state where/how required local-doc updates will be performed and how completion evidence will be recorded.
