# Handoff — Tier 2 (post v0.30.6)

**State at handoff (2026-09-07):** v0.30.6 released (npm `latest`, provenance, GitHub release).
`main` clean at `9a07a0de`. No open PRs. Pi-private copy = pre-release build `bedb2c594fcc`
(functionally 0.30.6, package.json still says 0.30.5) — `npm i -g taskplane@0.30.6` aligns it.
Full suite 3957 pass / 0 fail / 1 skip. Lint baseline **284** warnings / 671 infos (must not drift).

## Working rules that held (keep them)
- Feature branch off `main` → conventional commits → PR → CI → `--merge` (never squash) → sync main.
- Sage at every risky seam: design pass → per-stage code review → repeat until explicit sign-off.
  Sage's blockers were real every time (nine rounds on #631, seven on the pause fix). Budget for it.
- Behavioural tests over source-string assertions (mock `spawnAgent` via `mock.module`, real lane-runner;
  pure-state tests on real `computeResumePoint`/`selectCatchUpLanes`/`serializeBatchState`).
- **Assert on the file after every CHANGELOG write** (six entries were silently dropped pre-release).
- Local deploy = copy `package.json#files` to `~/.pi/agent/npm/node_modules/taskplane/`; verify by
  SHA-256 and the `taskplaneBuild` marker in `.pi/runtime/<batch>/engine.json`, not the version string.
- Shell gotchas: `node -e` heredocs eat `\s` in regexes and choke on apostrophes → write patch scripts
  to `.tmp-*.mjs` files; biome reflows anchors → re-read before editing; multi-edit calls are atomic.
- Penster config lives in `.pi/taskplane-config.json` (camelCase keys), not task-runner.yaml.

## Tier 2 — one coherent design pass (Sage `objective: design` first), likely 2–3 branches

### A. #627 `held` state — the anchor item (first)
Live evidence: a correctly-held lane burned 10 iterations / 5 relaunches / 15 intercepts in ~1h; the
Tier-1 bridge (hold-aware relaunch, `info`=ack / `steer`=ruling, hold exits not consuming iterations,
`exitInterceptTimeoutSec`) keeps a lane alive only while a supervisor acks. Sage's minimum bar:
- **Runner-owned hold state machine** (in lane-runner, NOT an in-tool wait): no worker process while
  holding, zero cost, no iteration/relaunch/stall consumption.
- **Durable hold record** `{batchId, taskId, segmentId, escalationId, deadline, deliveryState}`
  restored before any spawn/completion decision; survives pause/crash/resume (today `pendingEscalation`
  is volatile → hold-prompt intermittency, feedback #3 item 3).
- **Held mailbox target** the supervisor can reach with no live worker pid (`send_agent_message`
  currently requires registry liveness; `collectKnownAgentIds` excludes exited agents).
- **Monitor awareness**: `execution.ts` stall monitor kills on STATUS mtime ≥60 min AND on stale lane
  snapshot (~30 min) — runner-held ≠ dead worker; heartbeat both.
- **Ruling into the relaunched worker's initial input** (`checkMailbox` runs at `message_end`, not
  before the first prompt).
- `query` wakes but never releases; `abort` cancels, never approves; **typed rulings carrying the
  ruler's role** (supervisor vs operator), correlated by escalation id (replyTo), not timestamps.
- Hold blocks completion; checked before completion paths, not only on no-progress exits.
- Durable deadline that acks do not silently extend; define whether administrative pause suspends it.
- "Gate closed by ratification" record (who ratified, proof set, findings ruled vs fixed, escalation
  closed) — Penster's delegated-closure pattern, now standard on RL3 packets; must land before `.DONE`.
Acceptance criteria are on #627 (comments). Config surface: `taskRunner.holdTimeoutMinutes` (~240).

### B. #631 residuals — engine lease/generation
- Two simultaneous replacement sessions can both authorize against one verified-dead target.
- `markEngineExited` is read-check-write, not CAS (pid match covers the sequential case only).
- Restoration of persisted `mergeResults` drops `repoResults` (workspace per-repo history) — small.
Design: atomic exclusive claim (generation-tagged) before recovery writes or engine init; fencing of
old engines from persistence/spawn/merge/cleanup, not just lock expiry.

### C. #628 takeover state machine
`supervisor_takeover` treated a paused wave as terminal (task skipped, batch "completed 0/1", no-op
merge, branch removal). Data-loss half fixed (dirty-worktree refusal); the phase/state transition is the
open half. Reporter's acceptance criteria on #628 are the spec. Reuse the #633 pause semantics
(pending, never skipped; finalize as paused; catch-up merge on resume).

### D. #626 full coverage gate
Steps with **no review file at all** are not blocked (TP-2019 class). Needs Review-Level semantics,
waiver path, segment-scoped coverage. Depends on A's ratification record.

### E. #630 remaining
In-tool `waitForReply` / "supervisor busy" heartbeat — subsumed by A. Close #630 when A ships.

## Key code map (for the design pass)
- `lane-runner.ts`: iteration loop (`productiveIterations`), `pendingEscalation` / `lastSupervisorReplyTs`
  / `MAX_HOLD_RELAUNCHES`, exit-intercept (`onPrematureExit`, inbox poll), `findBlockingReviewGates`,
  remediation spawn, review-gated step completion, `drainAndSurfaceOutbox`, `bridgeReviewEvent`.
- `engine-identity.ts`: `engine.json`, `decideRecoveryOwnership` (the single gate), confirm path.
- `extension.ts`: `recoveryOwnershipGate`, `resolveRecoveryTarget`, `canonicalStateRoot`,
  `doOrchPause` (administrative branch), `doOrchRetryTask` (skipped/completed reopen), `buildCiDeps`.
- `resume.ts`: 8c re-execute (+`applyReExecutionOutcomeToSegments`, `advanceActiveSegment`),
  8d catch-up merge (`selectCatchUpLanes`), pause finalizer, merge-history restoration.
- `execution.ts`: `executeWave` tally (`pausedTaskIds`), stall monitor (~L950–1090), `buildWorkerEnv`.
- `agent-host.ts`: `checkMailbox` (delivery + `.steering-pending` with `type`), exit-intercept race.
- `segment-recovery.ts`, `git.ts` (`describeOrchBranchState*`), `supervisor-primer.md` Pattern 9 /
  Playbook D / hold contract.

## Open loops
- Ask Penster for the next batch's `engine.json` build marker + any `Hold acknowledged` /
  `Step completion withheld` / `Duplicate review boundary` STATUS lines (tells us which upstream
  cause duplicates reviews).
- #594 still awaiting reporter diagnostics. #617/#614/#615 (discovery/doctor P0/P1s from July) untouched.
