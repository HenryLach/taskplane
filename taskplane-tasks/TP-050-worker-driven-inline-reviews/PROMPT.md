# Task: TP-050 - Worker-Driven Inline Reviews

**Created:** 2026-03-24
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Touches the core execution model (task-runner), agent templates, and dashboard. High blast radius across worker execution, review spawning, and dashboard rendering. Moderate novelty — new tool registration pattern, but builds on established `spawnAgentTmux()` and `doReview()` infrastructure. No security changes, easy to revert.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-050-worker-driven-inline-reviews/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Reinstate per-step reviews while preserving the persistent worker context model
from TP-048. Currently, the worker handles all steps in a single context and
reviews only run after the worker exits — meaning substantive code steps get zero
review feedback during implementation. This task makes the **worker agent** drive
the review process by invoking a `review_step` extension tool at step boundaries.

The reviewer spawns in its own tmux session with the RPC wrapper (full telemetry),
the worker's context is preserved across the tool call, and the dashboard shows
live reviewer activity so the UI doesn't appear frozen during reviews.

**Issue:** Related to #140 (persistent context review gap), #121 (dashboard feedback during reviews)

## Dependencies

- **Task:** TP-049 (RPC telemetry for all agent types — reviewer tmux/RPC spawn pattern)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — current step loop (~line 2080+), `doReview()` (~line 2493+), `spawnAgentTmux()` (~line 1534+), `writeLaneState()` (~line 384+), tool registration patterns
- `extensions/taskplane/execution.ts` — lane monitoring, lane-state sidecar consumption
- `templates/agents/task-worker.md` — worker system prompt (needs review protocol)
- `templates/agents/local/task-worker.md` — local worker template (needs same update)
- `dashboard/server.cjs` — `serveState()`, lane-state reading, telemetry aggregation
- `dashboard/public/app.js` — lane rendering, reviewer status display

## Environment

- **Workspace:** `extensions/`, `dashboard/`, `templates/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `templates/agents/task-worker.md`
- `templates/agents/local/task-worker.md`
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `extensions/tests/*` (new or modified test files)

## Steps

### Step 0: Preflight

- [ ] Read the current step loop in `task-runner.ts` to understand how the worker handles all steps and how reviews are currently deferred to after worker exit
- [ ] Read `doReview()` to understand the existing reviewer spawn, review request generation, and verdict extraction
- [ ] Read `spawnAgentTmux()` to understand the RPC wrapper spawn pattern with `onTelemetry` callback
- [ ] Read `writeLaneState()` to understand the lane-state sidecar structure and existing reviewer fields
- [ ] Read dashboard lane rendering code in `app.js` to understand how lanes are displayed
- [ ] Understand pi's extension tool registration API (`pi.registerTool()` or equivalent)

### Step 1: Register `review_step` extension tool

Register a `review_step` tool in the task-runner extension that the worker agent
can invoke. The tool:

**Input parameters:**
- `step` (number) — the step number to review
- `type` ("plan" | "code") — the review type

**Behavior:**
1. Read the current task config to get reviewer model, tools, thinking settings
2. Generate the review request file (reuse existing `generateReviewRequest()` logic)
3. Update lane-state sidecar: `reviewerStatus: "running"`, `reviewerStep`, `reviewerType`, `reviewerSessionName`
4. Spawn the reviewer via `spawnAgentTmux()` in a new tmux session (e.g., `{tmuxPrefix}-reviewer`):
   - Uses RPC wrapper (sidecar JSONL + exit summary)
   - Uses `onTelemetry` callback to update lane-state sidecar with reviewer metrics in real-time:
     `reviewerElapsed`, `reviewerContextPct`, `reviewerLastTool`, `reviewerToolCount`,
     `reviewerCostUsd`, `reviewerInputTokens`, `reviewerOutputTokens`
5. Await reviewer completion (promise resolves when tmux session exits)
6. Read the review output file, extract verdict
7. Update lane-state sidecar: `reviewerStatus: "done"`, clear metrics
8. Log the review in STATUS.md (reuse existing `logReview()` logic)
9. Return verdict to the worker as the tool result:
   - `"APPROVE"` — worker proceeds
   - `"REVISE: <summary of feedback>"` — include a brief summary so the worker knows what to address. The full review is in `.reviews/R00N-{type}-step{N}.md`
   - `"RETHINK"` — plan review asked for reconsideration
   - `"UNAVAILABLE"` — reviewer failed to produce output

**Tool definition:**
The tool should have a clear `description` and `promptSnippet` so the worker
knows when and how to use it. The `promptSnippet` should NOT appear in the
system prompt's Available Tools section for non-orchestrated mode — only register
the tool when running in orchestrated tmux mode (check `isOrchestratedMode()`).

**Artifacts:**
- `extensions/task-runner.ts` (modified — tool registration + handler)

### Step 2: Remove deferred review logic from the step loop

The current step loop (post-TP-048) defers reviews to after the worker exits.
Remove this deferred review logic since the worker now drives reviews inline
via the `review_step` tool.

Specifically:
- Remove the "run reviews for newly completed steps after worker exits" block
- Remove the "if REVISE, mark step incomplete for rework" logic (worker handles this inline)
- Keep the iteration mechanism (worker exits on context limit, restarts from last incomplete step)
- Keep low-risk step skip logic in the step loop as a safety net (worker template also skips, but belt-and-suspenders)

**Important:** The step loop should still track review state (review counter,
logged reviews) via the existing STATUS.md mechanisms. The `review_step` tool
handler writes these, not the loop.

**Artifacts:**
- `extensions/task-runner.ts` (modified — step loop simplification)

### Step 3: Update worker agent template with review protocol

Add review protocol instructions to the worker system prompt. The worker
decides when to review based on the task's review level (parsed from PROMPT.md
and available in STATUS.md header).

```markdown
## Review Protocol

You have access to a `review_step` tool that spawns a reviewer agent to evaluate
your work. Use it at step boundaries based on the task's review level:

**Review Level 0 (None):** Skip all reviews.
**Review Level 1 (Plan Only):** After reading the step requirements but BEFORE
  implementing, call `review_step` with type "plan" to get plan feedback.
**Review Level 2 (Plan + Code):** Plan review before implementing, then code
  review after implementing and committing.
**Review Level 3 (Full):** Plan + code + test review.

**Skip reviews for:** Step 0 (Preflight) and the final documentation/delivery step.

**Handling verdicts:**
- APPROVE → proceed to next step
- RETHINK → reconsider your plan approach, adjust, then implement
- REVISE → read the review file in .reviews/ for detailed feedback,
  address the issues, commit fixes, then proceed
- UNAVAILABLE → reviewer failed, proceed with caution

**Example flow for a Review Level 2 task, Step 3:**
1. Read Step 3 requirements
2. Call `review_step(step=3, type="plan")` → get plan feedback
3. Implement Step 3
4. Commit changes
5. Call `review_step(step=3, type="code")` → get code feedback
6. If REVISE: fix issues, commit again
7. Move to Step 4
```

Update both `templates/agents/task-worker.md` and `templates/agents/local/task-worker.md`.

**Artifacts:**
- `templates/agents/task-worker.md` (modified)
- `templates/agents/local/task-worker.md` (modified)

### Step 4: Update lane-state sidecar with reviewer metrics

Extend `writeLaneState()` to include reviewer telemetry fields when a review
is active. The `review_step` tool handler calls `writeLaneState()` on each
`onTelemetry` tick from the reviewer's `spawnAgentTmux()`.

New fields in the lane-state sidecar JSON:
```json
{
  "reviewerStatus": "running",
  "reviewerSessionName": "orch-henrylach-lane-1-reviewer",
  "reviewerType": "code",
  "reviewerStep": 3,
  "reviewerElapsed": 45000,
  "reviewerContextPct": 12.3,
  "reviewerLastTool": "read extensions/taskplane/merge.ts",
  "reviewerToolCount": 8,
  "reviewerCostUsd": 0.42,
  "reviewerInputTokens": 15000,
  "reviewerOutputTokens": 3200,
  "reviewerCacheReadTokens": 50000,
  "reviewerCacheWriteTokens": 5000
}
```

When the reviewer is idle, these fields should be zeroed/cleared (not omitted —
dashboard expects consistent shape).

**Artifacts:**
- `extensions/task-runner.ts` (modified — `writeLaneState()` extension)

### Step 5: Dashboard reviewer sub-row

Update the dashboard to render a reviewer activity row below the worker row
when `reviewerStatus === "running"` for a lane.

**Server side (`server.cjs`):**
- The lane-state sidecar already has reviewer fields — ensure `serveState()`
  passes them through to the client. No new API endpoints needed.

**Client side (`app.js`):**
- In the lane rendering function, check `laneState.reviewerStatus`
- When `"running"`: render a sub-row under the worker row:
  ```
  Lane 1 | TP-049 | ● Worker 12m | 🔧 45 | [awaiting review]    | $3.20 | ctx 13%
                     ● Reviewer 1m | 🔧 8  | read merge.ts        | $0.42 | ctx 12%
  ```
- The worker row should show `[awaiting review]` or similar instead of its
  last tool call when a review is in progress
- When reviewer finishes (`"done"` or `"idle"`): hide the sub-row, restore
  normal worker display
- Reviewer cost should be included in the lane's total cost display

**Styling:**
- Reviewer sub-row should be visually distinct (lighter background, indented,
  or prefixed with a review icon like 📋)
- Use the same metric format as the worker row (elapsed, tool count, last tool, cost, context%)

**Artifacts:**
- `dashboard/server.cjs` (modified if needed)
- `dashboard/public/app.js` (modified — reviewer sub-row rendering)

### Step 6: Testing & Verification

> ZERO test failures allowed.

- [ ] Run tests: `cd extensions && npx vitest run`
- [ ] Verify all existing tests pass
- [ ] Add tests for: `review_step` tool registration (only in orchestrated mode)
- [ ] Add tests for: `review_step` tool handler generates review request, spawns reviewer, returns verdict
- [ ] Add tests for: lane-state sidecar includes reviewer metrics when active
- [ ] Add tests for: step loop no longer runs deferred reviews
- [ ] Add tests for: worker template includes review protocol instructions

### Step 7: Documentation & Delivery

- [ ] Update worker agent templates (done in Step 3)
- [ ] Check if execution-model.md or review-loop.md need updates
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `templates/agents/task-worker.md` — review protocol (done in Step 3)
- `templates/agents/local/task-worker.md` — same

**Check If Affected:**
- `docs/explanation/execution-model.md` — describes step loop and review timing
- `docs/explanation/review-loop.md` — describes review cadence

## Completion Criteria

- [ ] Worker drives reviews via `review_step` tool at step boundaries
- [ ] Reviewer spawns in tmux session with RPC wrapper (attachable, telemetry)
- [ ] Worker context preserved across review tool calls
- [ ] Review level scoring (0-3) determines which reviews the worker invokes
- [ ] Low-risk steps (Step 0, final step) skip reviews
- [ ] REVISE verdict addressed by worker inline (same context)
- [ ] Lane-state sidecar has real-time reviewer metrics
- [ ] Dashboard shows reviewer sub-row with live activity during reviews
- [ ] Dashboard no longer appears frozen during review phases
- [ ] Review artifacts written to `.reviews/` folder as before
- [ ] All tests passing (existing + new)
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-050): complete Step N — description`
- **Bug fixes:** `fix(TP-050): description`
- **Tests:** `test(TP-050): description`
- **Hydration:** `hydrate: TP-050 expand Step N checkboxes`

## Do NOT

- Change the RPC wrapper (`bin/rpc-wrapper.mjs`)
- Change the reviewer agent template (`task-reviewer.md`) — the reviewer's behavior doesn't change, only how it's spawned
- Remove the iteration/safety-net mechanism (worker can still iterate on context overflow)
- Remove `writeLaneState()` or the lane-state sidecar (still needed by dashboard)
- Register the `review_step` tool in non-orchestrated mode (only available in tmux/orch mode)
- Change merge agent behavior

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
