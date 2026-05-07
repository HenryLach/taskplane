# TP-187: Supervisor recovery flows — Status

**Current Step:** Step 1: Plan all three sub-fix designs
**Status:** 🟨 In Progress
**Last Updated:** 2026-05-07
**Review Level:** 3
**Review Counter:** 1
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ Per TP-186's Order of Operations rule** (which should be live in the base
> worker prompt by the time this task runs): do NOT mark a step `Complete`
> until that step's code review (or test review for steps gated by it) has
> returned APPROVE. This task is Review Level 3 — code AND test reviews fire
> on Step 6.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main` (lane worktree)
- [x] TP-186 confirmed merged (grep `templates/agents/task-worker.md` for "Order of operations")
- [x] Baseline test count recorded
- [x] All Tier 3 context files read
- [x] Issues #538, #539, #540 read in full
- [x] Decision recorded: which optional sub-features (e.g., #540C tool-call summaries) included

---

### Step 1: Plan all three sub-fix designs
**Status:** 🟨 In Progress

> ⚠️ Plan-review checkpoint. Reviewer evaluates architectural choices.

- [x] #538 design sketched (drain hook location, supervisor_takeover semantics)
- [x] #539 design sketched (reconstruction logic, partial-state policy, multi-batch heuristic)
- [x] #540 design sketched (fallback location, optional tool-call summary format)
- [x] Drafts in Discoveries

#### Design #538 — mailbox drain + supervisor_takeover

**Drain hook location:**
- Add a new helper `drainAgentOutbox(stateRoot, batchId, agentId)` in `mailbox.ts` that synchronously moves all pending `*.msg.json` files from the agent's outbox to `outbox/processed/` (using the same rename-into-processed pattern as `ackOutboxMessage`). This prevents the supervisor from later being shown stale escalations/replies that were emitted by a now-dead worker.
- Call `drainAgentOutbox` synchronously at lane termination decision points:
  - **In `lane-runner.ts`**: at the no-progress kill path (line ~982) immediately before `return makeResult(... "failed" ...)`. Drain the worker agent's outbox.
  - **In `engine.ts`**: at the hard-fail path that constructs the failure outcome and emits the `task-failure` alert (around line 3008–3033). Drain via `resolveTaskWorkerAgentId` to find the worker's outbox.
- Best-effort: drain failures must not block lane termination (catch + log).

**Zombie-alert filter (the part operators actually see):**
- The on-disk outbox drain alone does not stop alerts already queued in the supervisor's pi message queue. Add a per-lane terminal-state filter at the supervisor-alert delivery boundary in `extension.ts`:
  - Maintain a `terminatedLanes: Map<number, number>` (laneNumber → terminatedAt epoch ms) and `terminatedAgents: Map<string, number>` (agentId → terminatedAt epoch ms) at supervisor-process scope.
  - Engine-worker emits a new IPC message `lane-terminated` with `{ laneNumber, agentId, batchId, terminatedAt }` whenever a lane reaches a terminal state (no-progress kill OR hard-fail).
  - In the `case "supervisor-alert":` handler (extension.ts:1170), before invoking `onSupervisorAlert`, check whether `alert.context.laneNumber`/`alert.context.agentId` is in the terminated map. If yes, drop the alert (log to stderr for diagnostics) instead of forwarding to `pi.sendUserMessage`. The check is presence-based (any termination record) — the timestamp is informational/diagnostic.
  - **Suppression lifecycle (per R001 plan-review feedback):**
    1. **Lane re-spawn** — when the engine re-allocates lane number N for a new task in a future wave, it emits `lane-respawned { laneNumber, agentId }` before that lane runs. Extension.ts removes the entry from the terminated maps. This is the natural unmute boundary: a fresh lane gets a fresh alert lifetime.
    2. **`orch_resume`** — `doOrchResume` clears both maps before launching the engine worker. After force-resume the supervisor MUST see new alerts.
    3. **New batch** — batch transitions to a new `batchId` clear both maps (new state-sync IPC carries a different batchId, supervisor wipes everything from the previous batch).
    4. **`supervisor_takeover`** — marks all currently-known active lanes as terminated. Combined with the pause signal, this drops the in-transit zombie alerts but leaves the maps in place. When the operator subsequently calls `orch_resume`, lifecycle rule #2 fires and clears the suppression so future alerts get through.
- This is the synchronous "drain" the operator perceives: zombie alerts get filtered before they reach pi's user-message queue, while legitimate alerts after recovery are not suppressed.

**`supervisor_takeover(reason)` tool semantics:**
- Registered alongside other `orch_*` tools in `extension.ts` (NOT in `agent-bridge-extension.ts` — that file is loaded into worker/reviewer/merger only). Therefore NOT added to `ENGINE_BRIDGE_TOOLS`.
- On invocation:
  1. **Pause the wave**: same code path as `orch_pause` — set `orchBatchState.pauseSignal.paused = true`, send `{type:"pause"}` to engine-worker.
  2. **Drain all per-agent alert queues**: clear in-memory terminated sets, mark ALL active agents as terminated (this filter suppresses any further alerts for the duration of takeover); also synchronously drain on-disk outboxes for all known agents in the current batch via the new helper.
  3. **Preserve worktrees + state**: do NOT call `executeAbort` or `deleteBatchState`. Worktrees, branches, and `.pi/batch-state.json` remain.
  4. Return a structured text result describing what was paused / drained / preserved and the recommended next steps (`orch_status`, `orch_resume`, `orch_abort` if escalation needed).
- Distinct from `orch_abort` because it does NOT delete state and does NOT kill sessions — it pauses + drains + parks for manual recovery.

**Supervisor template documentation (`templates/agents/supervisor.md`):**
- Add a section documenting `supervisor_takeover(reason: string)` semantics.
- Document the existing text-reply parser semantics that lane-runner.ts uses: `skip` / `let it fail` / `close` / `abort` / `stop` are CLOSE_DIRECTIVES only when they are short (< 30 chars) standalone replies (or prefixes followed by `:`, ` `, `.`, ` -`). Embedding them in longer text is treated as instructions.

#### Design #539 — resume reconstruction from disk

**Entry point:** `resumeOrchBatch` in `resume.ts:1060`. After `loadBatchState(stateRoot)` returns null AND `force === true`, attempt reconstruction.

**Reconstruction policy: prefer fail-loud over partial reconstruction.**
The spec explicitly accepts "fail loudly with a clear error message" as the recovery path. Full state reconstruction from runtime/agent logs is genuinely fragile (we'd need to rebuild OrchBatchPhase, wave plan, lane allocations, segment frontiers, merge results, resilience counters). A partial reconstruct would be likely to silently mis-resume.

**Implementation:**
- When `loadBatchState` returns null AND `force === true`:
  1. Read `.pi/batch-history.json` via `loadBatchHistory(stateRoot)`.
  2. If the history is empty or has no entries, fall through to the existing `resumeNoState()` error.
  3. If a recent entry exists (most-recent-wins by ordering: newest first per `saveBatchHistory`), surface a focused, actionable error: it identifies the most recent batchId, the worktree paths that still exist, and recommends `orch_start <PROMPT.md>` as the recovery path.
- New message helper in `messages.ts`: `resumeNoStateAfterAbort(batchId, worktreePathsExisting)` returning a clear multi-line error.
- `resume.ts` handles `force=true` with empty in-memory state by reading from disk first (today's behavior is correct — `loadBatchState` reads from disk — the issue is purely about the post-abort case where the file is gone). The new behavior: when state file is gone but batch-history is not, still emit a clear error pointing to `orch_start` rather than the generic `resumeNoState()`.
- **Multi-batch heuristic:** batch-history is sorted newest-first (line 1865 in persistence.ts: `nextHistory.unshift(summary)`). "Most recent wins" is just `history[0]`. Document this in the message and in inline comments.

**No changes to types.ts (no new state values needed)** — the existing `stopped`/`failed`/`paused` phase distinctions are sufficient; the issue is purely about the missing-state-file case.

#### Design #540 — non-empty reason + assistant_message fallback

**Worker prompt change (`templates/agents/task-worker.md`):**
- Find the existing `Never Narrate What You Plan To Do` / `If you are unsure how to proceed` section and add a hard MUST: "If you DO exit-with-no-progress, you MUST first emit a one-sentence assistant message stating the specific reason (what you tried, what failed, what you need). Empty/silent exits will be intercepted with the most-recent assistant_message used as a fallback reason."

**Lane-runner change (`lane-runner.ts:688`-712):**
- The exit-intercept callback receives `assistantMessage` (already the most recent assistant message at that turn). The current code sets `truncatedMsg = assistantMessage.slice(0, 500)`. If `assistantMessage` is empty (whitespace-only or zero-length), the alert payload says `Worker said: ""`.
- Fallback: when `assistantMessage.trim() === ""`, read the worker's `events.jsonl` (path = `eventsPath` already in scope; agent events appended via `appendAgentEvent`) and walk back to find the most recent `assistant_message` event with non-empty text. Use that as the message.
- If `events.jsonl` also yields nothing, fall back to a literal sentinel: `"(no assistant message captured — worker exited without producing visible output)"`.
- (Optional/deferred per Step-0 decision: tool-call summaries from #540C are NOT included in this iteration.)

**File-shape note:** `events.jsonl` is appended-line JSON. Each line is a JSON event with `type` and `payload`. `assistant_message` events are emitted by the agent host. Read the file backwards (or read fully and iterate from the end) to find the most recent one.


---

### Step 2: Implement #538 — mailbox drain + supervisor_takeover
**Status:** ⬜ Not Started

- [ ] Synchronous mailbox drain at lane termination decision points (engine.ts hard-fail + lane-runner.ts no-progress kill)
- [ ] `supervisor_takeover(reason)` tool registered in extension.ts (alongside `orch_*` tools, NOT in agent-bridge-extension.ts; NOT in ENGINE_BRIDGE_TOOLS)
- [ ] Zombie-alert filter (terminatedLanes / terminatedAgents) wired into `case "supervisor-alert"` IPC handler in extension.ts with the lifecycle rules from the Step 1 design
- [ ] `templates/agents/supervisor.md` documents the tool + text-reply parser semantics
- [ ] Targeted tests pass

---

### Step 3: Implement #539 — resume reconstruction from disk
**Status:** ⬜ Not Started

- [ ] resume.ts force=true path reads from disk when in-memory state empty
- [ ] Loud failure with documented error message when no on-disk state
- [ ] Targeted integration test passes
- [ ] Multi-batch edge case handled (most recent wins, documented)

---

### Step 4: Implement #540 — non-empty reason + fallback
**Status:** ⬜ Not Started

- [ ] templates/agents/task-worker.md requires non-empty exit-no-progress reason
- [ ] lane-runner.ts falls back to most-recent assistant_message when reason empty
- [ ] (Optional) Last 2–3 tool-call summaries included in alert payload
- [ ] Targeted test passes

---

### Step 5: Add tests
**Status:** ⬜ Not Started

- [ ] supervisor-recovery-flows.test.ts created
- [ ] Coverage: mailbox drain, supervisor_takeover, resume reconstruction, worker-said fallback
- [ ] Targeted run passes

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed. Code AND test reviews fire here (Level 3).

- [ ] FULL fast suite passing
- [ ] Integration suite passing
- [ ] CLI smoke clean
- [ ] Code-review checkpoint at Step 6 (do NOT mark earlier steps Complete until APPROVE)
- [ ] Test-review checkpoint at Step 6

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG.md three Unreleased / Fixed entries (#538, #539, #540)
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Baseline test count: 3496 passing, 1 skipped, 0 failed (107 test files) | Captured | Step 0 |
| TP-186 merged (Order of Operations rule live in templates/agents/task-worker.md:281) | Confirmed | Step 0 |
| Optional #540C (tool-call summaries) — DEFERRED. Most-recent assistant_message fallback is the spec-required minimum and addresses the issue. Tool-call summaries can land in a follow-up if needed. | Decision | Step 0 |
| Branch is `task/henrylach-lane-1-20260506T230236` (lane worktree branch, not `main`). Treating as the lane worktree per orchestrated run. | Note | Step 0 |
| Issue #538 architecture: alerts emitted by lane-runner via `config.onSupervisorAlert` are forwarded to extension.ts via `supervisor-alert` IPC, then queued via `pi.sendUserMessage(...)`. Multiple iterations queue multiple alerts in supervisor's pi message queue. After lane termination they remain queued — the "3-5 zombie alerts" the operator sees. | Architecture | engine.ts/extension.ts |
| Issue #539 root cause: `orch_abort()` calls `executeAbort()` which calls `deleteBatchState()`. This wipes `.pi/batch-state.json`. Then `orch_resume(force=true)` runs `loadBatchState()` → null → returns with `resumeNoState()` error message. `.pi/batch-history.json` is preserved across abort and contains the most recent batch summary. | Architecture | abort.ts/resume.ts/persistence.ts |
| Issue #540 location: `lane-runner.ts:691-712` — alert payload includes `Worker said: "${truncatedMsg}"` where `truncatedMsg = assistantMessage.slice(0, 500)`. The fallback should occur if `assistantMessage` is empty/whitespace. | Architecture | lane-runner.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-07 03:02 | Task started | Runtime V2 lane-runner execution |
| 2026-05-07 03:02 | Step 0 started | Preflight |

---

## Blockers

*None — but ideally TP-186 ships first so the death-spiral is fixed before
this task's worker is exposed to it during long-running review cycles.*

---

## Notes

- Bundles three P1/P2 issues filed together with TP-186's P0 in the same
  failed-batch postmortem. They cluster: #538 and #540 surface during the
  death-spiral; #539 surfaces when operators reach for `orch_abort` to escape.
- After TP-186 ships and is validated, this task can run safely. Recommended
  release: v0.28.7 with TP-187 + TP-188 bundled (both depend on TP-186 being
  live in the worker spawn pipeline for safe execution).
| 2026-05-07 03:12 | Review R001 | plan Step 1: REVISE |
