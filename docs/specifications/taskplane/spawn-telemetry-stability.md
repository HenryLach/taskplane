# Spawn & Telemetry Stability — Investigation Log and Specification

> **Purpose:** Persistent memory store documenting all spawn crashes, telemetry failures,
> root causes found, fixes attempted, and remaining open issues. This document serves as
> the authoritative reference for future context iterations and alternate analysis.
>
> **Status:** Active investigation — last updated 2026-03-30
> **Versions covered:** v0.22.11 through v0.22.18
>
> **Follow-on architecture suite:** See `docs/specifications/framework/taskplane-runtime-v2/`
> for the long-term no-TMUX runtime redesign created from this investigation.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Problem Inventory](#2-problem-inventory)
3. [Root Causes Found and Fixed](#3-root-causes-found-and-fixed)
4. [Remaining Open Problem: tmux Session Race Condition](#4-remaining-open-problem-tmux-session-race-condition)
5. [Telemetry Pipeline Status](#5-telemetry-pipeline-status)
6. [Chronological Fix History](#6-chronological-fix-history)
7. [Test Results and Evidence](#7-test-results-and-evidence)
8. [Key Code Locations](#8-key-code-locations)
9. [Environment Details](#9-environment-details)
10. [Next Steps](#10-next-steps)

---

## 1. Architecture Overview

### Process Hierarchy

```
Operator's pi session (supervisor)
│
└── Engine (worker_thread in operator's pi process)
    │   Deterministic TypeScript — discovers tasks, computes waves,
    │   assigns lanes, spawns lane sessions, polls for .DONE files,
    │   orchestrates merges.
    │
    ├── Lane Session (tmux: orch-henrylach-lane-1)
    │   │   Spawned by execution.ts via `tmux new-session -d`
    │   │   Runs: rpc-wrapper.mjs → pi → task-runner.ts (extension)
    │   │   The lane's pi process loads task-runner as an extension.
    │   │   Task-runner manages the worker lifecycle.
    │   │
    │   ├── Worker Session (tmux: orch-henrylach-lane-1-worker)
    │   │       Spawned by task-runner.ts via spawnAgentTmux()
    │   │       Runs: rpc-wrapper.mjs → pi → LLM agent
    │   │       Does the actual task work (reads PROMPT.md, writes code)
    │   │
    │   └── Reviewer Session (tmux: orch-henrylach-lane-1-reviewer)
    │           Spawned by task-runner.ts for plan/code reviews
    │           Runs: rpc-wrapper.mjs → pi → LLM reviewer
    │
    └── Merge Session (tmux: orch-henrylach-merge-N)
            Spawned after wave completes
            Runs: rpc-wrapper.mjs → pi → merge agent
```

### Telemetry Pipeline

```
Worker pi process
  → rpc-wrapper captures events → writes to sidecar JSONL file
  → rpc-wrapper queries get_session_stats → writes contextUsage to sidecar

Task-runner (in lane pi process)
  → polls sidecar JSONL every 2 seconds (tailSidecarJsonl)
  → extracts: tokens, cost, context%, tool calls, retries
  → updates lane-state JSON file
  → dashboard reads lane-state JSON for display

Key files:
  .pi/telemetry/{name}-{role}.jsonl     — sidecar events (rpc-wrapper writes)
  .pi/telemetry/{name}-{role}.jsonl.pid — PID file for orphan cleanup
  .pi/telemetry/{name}-{role}-exit.json — exit summary (rpc-wrapper writes on exit)
  .pi/telemetry/{name}-{role}-stderr.log — stderr capture (tmux redirect)
  .pi/lane-state-{session}.json         — dashboard telemetry (task-runner writes)
```

### Sidecar Naming Convention

```
{opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}.jsonl

Lane sidecar:   henrylach-{timestamp}-default-tp-091-lane-1-lane.jsonl
Worker sidecar: henrylach-{batchId}-default-tp-091-lane-1-worker.jsonl
```

Lane uses `Date.now()` timestamp as batchId (from execution.ts `generateTelemetryPaths`).
Worker uses `ORCH_BATCH_ID` env var as batchId (from task-runner.ts `generateStableSidecarPaths`).
The role suffix differentiates them: `lane` vs `worker`.

---

## 2. Problem Inventory

### P1: Worker Startup Crashes (100% failure rate on first attempt)

**Symptom:** Worker tmux session (`orch-henrylach-lane-1-worker`) dies within 300ms of creation. Exit code 1, 0 tokens, 0 tool calls. Happens consistently on every first spawn attempt. Retries eventually succeed (typically after 5-10 attempts across 2-3 iteration cycles).

**Impact:** Wastes 30-60 seconds per task on failed spawns. Can exhaust the lane session's context window before the worker ever starts meaningful work.

**Status:** Partially fixed (command line length), partially open (tmux race condition).

### P2: Worker Telemetry Invisible (dashboard shows zeros)

**Symptom:** Dashboard shows `ctx: 0%, tools: 0, cost: 0` for workers that are actively running. The worker sidecar JSONL file either doesn't exist or is at a different path than what task-runner is tailing.

**Impact:** No visibility into worker progress. Context pressure thresholds (85% warn, 95% kill) never trigger. Supervisor can't see when to intervene.

**Status:** Multiple root causes found and fixed. One remains (orphan worker has no sidecar).

### P3: Lane Session Context Exhaustion

**Symptom:** The lane tmux session (`orch-henrylach-lane-1`) exits without creating .DONE file. The lane's pi process exhausted its context window from managing the worker lifecycle (spawn retries, reviewer management, polling).

**Impact:** All uncommitted worker progress is lost. The engine sees the lane as failed and pauses the batch.

**Status:** Partially mitigated by lean worker prompt (reduces lane's work). Root cause is that the lane's pi session accumulates context from all extension processing.

### P4: Orphan Processes

**Symptom:** Worker tmux session dies but the rpc-wrapper → pi child process survives. The orphan continues running (consuming API credits) but is invisible to the dashboard and task-runner.

**Impact:** Wasted compute. Multiple orphan workers can run simultaneously. Lane-state freezes because the poll loop exited when the tmux session disappeared.

**Status:** PID file mechanism added (TP-097) but orphan detection not fully effective when the tmux session dies before the PID file is written.

---

## 3. Root Causes Found and Fixed

### RC1: Context % Field Name Mismatch (v0.22.13, #338)

**Root cause:** Pi sends `contextUsage.percent` but task-runner checked for `contextUsage.percentUsed`. The authoritative context usage was silently ignored on every turn. The system fell back to manual token-based calculation which was inaccurate.

**Fix:** Read `cu.percent ?? cu.percentUsed` for backward compatibility. Remove manual token-based fallback from threshold decisions.

**Files:** `extensions/task-runner.ts` (sidecar tailing, onTelemetry callback)

**Verification:** Reviewer telemetry showed correct context % (24.7%) after fix, confirming the field name was the issue.

### RC2: Sidecar Filename Collision — Lane vs Worker (v0.22.16, #354)

**Root cause:** `execution.ts` `generateTelemetryPaths()` hardcoded `role = "worker"` for lane sessions. Both the lane sidecar and worker sidecar were named `*-lane-1-worker.jsonl`, differing only in the batchId segment. Task-runner tailed the worker sidecar (stable batchId path) but the only JSONL file that existed was the lane sidecar (timestamp path).

**Fix:** Changed lane role from `"worker"` to `"lane"` in `execution.ts`.

**Files:** `extensions/taskplane/execution.ts` line 178

**Evidence:** After fix, lane sidecar appears as `*-lane-1-lane.jsonl` — no collision.

### RC3: Duplicate Extension Loading (v0.22.15)

**Root cause:** The lane session was spawned with `-e C:\dev\taskplane\extensions\task-runner.ts` (explicit) but WITHOUT `--no-extensions`. Pi auto-discovered `task-runner.ts` from the worktree CWD (`extensions/` directory in the git worktree). Two copies of task-runner loaded and competed — one generated the stable sidecar path (logged), but the other actually spawned the tmux session (with a different path).

**Evidence:** Debug logging showed `spawnAgentTmux` taking the stable path, but rpc-wrapper received a timestamp path. Extension conflict error: `"Tool 'review_step' conflicts with C:\dev\taskplane\extensions\task-runner.ts"`.

**Fix:** Added `"--", "--no-extensions"` to the lane pi spawn command. Pi's `--no-extensions` disables auto-discovery while keeping explicit `-e` paths.

**Files:** `extensions/taskplane/execution.ts` line 593

**Note:** This issue is specific to self-hosting (taskplane developing itself). Normal user projects don't have `extensions/task-runner.ts` in their worktree CWD.

### RC4: Windows Command Line Length Limit (v0.22.17)

**Root cause:** rpc-wrapper read the system prompt from a file, then passed the FULL CONTENT as `--system-prompt <content>` on the pi command line. Worker system prompts (PROMPT.md + context docs + step instructions) routinely exceeded Windows' 32K CreateProcess command line limit. Pi exited with code 1 and stderr: `"The command line is too long"`.

**Evidence:** Pi stderr capture (added in v0.22.16) revealed the exact error message.

**Fix:** When system prompt exceeds 8K chars, rpc-wrapper writes it to a temp file and passes via `--append-system-prompt @filepath`. Temp file cleaned up on exit.

**Files:** `bin/rpc-wrapper.mjs`

**Note:** This fix is now superseded by RC5 (lean worker prompt eliminates the large system prompt entirely).

### RC5: Bloated Worker Prompt (v0.22.18)

**Root cause:** The worker prompt compiled ~50K of content inline: PROMPT.md content, STATUS.md content, step listings with completion status, context doc content, numbered execution instructions, archive suppression text, iteration nudge. All embedded in the system prompt passed to the LLM.

**Design insight:** The worker has `read` as a tool. PROMPT.md already contains file paths to all related docs. The worker template already has all execution instructions. There's no need to embed any of this in the prompt — just pass the file paths and let the worker read what it needs.

**Fix:** Reduced worker prompt from ~50K to ~500 chars. The prompt now contains:
- File paths to PROMPT.md and STATUS.md
- Task ID and task folder path
- Iteration number
- Wrap-up signal file path
- Archive suppression (if orchestrated)
- Iteration nudge (if recovering)

**Files:** `extensions/task-runner.ts` (`runWorker` function)

**Impact:** Eliminates the command line length issue at its source. Reduces initial context window consumption. Faster worker startup.

### RC6: Pi Stderr Not Captured (v0.22.16)

**Root cause:** When pi crashed on startup, the exit summary said `"pi process exited with code 1"` with no error detail. rpc-wrapper forwarded pi's stderr to its own stderr but didn't capture it for the exit summary.

**Fix:** rpc-wrapper buffers pi's stderr (last 2KB) and includes it in the exit summary error field on crash.

**Files:** `bin/rpc-wrapper.mjs`

**Impact:** This is what revealed RC4 (command line too long). Critical for diagnosing future crashes.

---

## 4. Remaining Open Problem: tmux Session Race Condition

### Symptom

Worker tmux sessions die within 300ms of creation, 100% of the time on the first 5 attempts. No exit JSON is written (rpc-wrapper never starts). The tmux session is created successfully (`tmux new-session -d` returns 0) but the session disappears before the command inside it begins executing.

This happens:
- After fresh system reboot
- With v0.22.18 (all prior fixes applied)
- With the lean ~500 char prompt (no command line length issue)
- Without extension conflicts (--no-extensions fix applied)
- Consistently on every batch run

### What We Tested

| Test | Result |
|------|--------|
| `tmux new-session -d -s test "sleep 10"` | ✅ 100% success (20/20) |
| `tmux new-session -d -s test "TERM=xterm-256color node -e 'setTimeout(()=>{},60000)'"` | ✅ 100% success (10/10) |
| `tmux new-session -d -s test "TERM=xterm-256color node rpc-wrapper.mjs --sidecar-path ... --system-prompt-file ... --prompt-file ... --tools read -- --thinking off --no-extensions --no-skills"` | ✅ 100% success (5/5) with real prompt files |
| Same command but during an actual batch run | ❌ 0% success on first 5 attempts |

### Key Observation

The crash ONLY happens during batch execution — not when the same command is run manually. This strongly suggests contention or timing issue when the lane session is already running and spawning child tmux sessions.

### Hypotheses

1. **tmux server contention:** The lane session creates child sessions rapidly. tmux's server may have a race condition when handling concurrent session creation on Windows/MSYS2.

2. **MSYS2 fork emulation:** tmux on MSYS2 uses Cygwin's fork emulation which is fragile. The `0xC0000142` (STATUS_DLL_INIT_FAILED) error seen earlier suggests DLL loader contention during rapid process creation.

3. **File descriptor exhaustion:** The lane session has multiple file descriptors open (sidecar files, stderr redirect, prompt files). Child tmux sessions inherit these, potentially hitting limits.

4. **tmux session name collision:** The worker session name `orch-henrylach-lane-1-worker` may collide with a zombie from a previous failed attempt. The code kills stale sessions before creating, but the kill may not complete before the create.

5. **Node.js spawnSync blocking:** `spawnSync("tmux", ["new-session", ...])` is synchronous. If the tmux server is busy processing the lane session, the new-session command may time out or fail.

### Evidence Against tmux-Only Explanation

The identical command works 100% when run manually from bash. The difference is the execution context — inside a pi extension running in a tmux session spawned by rpc-wrapper. This suggests the issue may be related to:
- The inherited environment from the lane process
- Process tree depth (operator pi → engine → lane tmux → lane rpc-wrapper → lane pi → task-runner extension → worker tmux)
- Resource limits specific to deeply nested process trees on Windows

### Potential Fixes to Try

1. **Add delay between kill and create:** Currently the code kills stale sessions and immediately creates. Add 500ms between.

2. **Use `tmux send-keys` instead of `tmux new-session`:** Create the session with a shell, then send the command. The session creation is simpler (just a shell) and the command execution is deferred.

3. **Use `tmux new-window` instead of `tmux new-session`:** Create worker windows inside the existing lane session instead of separate sessions. Avoids the server contention of multiple sessions.

4. **Spawn without tmux:** Use `child_process.spawn` directly for the worker. The worker doesn't need a visible terminal — it communicates via stdin/stdout (RPC mode) and sidecar files. tmux was originally added for dashboard visibility and `tmux attach` debugging, but these don't work anyway (the worker session dies or becomes an orphan).

5. **Increase verification delay:** The current `SPAWN_VERIFY_DELAY_MS` is 500ms (v0.22.14). The manual test used 3000ms and succeeded. Try 2000ms.

---

## 5. Telemetry Pipeline Status

### What Works (after v0.22.18)

| Component | Status | Notes |
|-----------|--------|-------|
| Pi `contextUsage.percent` field | ✅ Fixed | RC1 — reads correct field name |
| Lane sidecar role (`lane` not `worker`) | ✅ Fixed | RC2 — no filename collision |
| Single extension copy | ✅ Fixed | RC3 — `--no-extensions` prevents auto-discovery |
| Pi stderr in exit summary | ✅ Fixed | RC6 — last 2KB captured |
| Stable worker sidecar path | ✅ Code correct | `generateStableSidecarPaths` uses `ORCH_BATCH_ID` |
| Lean worker prompt | ✅ Fixed | RC5 — ~500 chars, no command line issue |
| Worker sidecar actually created | ❌ Broken | Worker tmux session dies before rpc-wrapper starts |
| Lane-state JSON updated | ❌ Broken | Poll loop exits when tmux session dies |
| Dashboard shows worker telemetry | ❌ Broken | No sidecar to tail |
| Context pressure thresholds | ❌ Broken | Context % stays at 0 |
| Context % snapshots | ❌ Broken | Requires working telemetry |

### The Gap

The entire telemetry pipeline is correct in code but broken in practice because the worker tmux session dies before rpc-wrapper can initialize. The rpc-wrapper process sometimes survives as an orphan (doing work, burning credits) but never creates its sidecar file because its initialization was interrupted by the tmux session death.

When a worker eventually starts successfully (after multiple iteration retries), it may work correctly — but by then the lane session has consumed significant context managing all the failed attempts, and often exhausts before the worker finishes.

---

## 6. Chronological Fix History

| Version | Date | Fix | Issue(s) | Result |
|---------|------|-----|----------|--------|
| v0.22.13 | 2026-03-29 | `percent` vs `percentUsed` field fix | #338 | ✅ Context % works when sidecar exists |
| v0.22.13 | 2026-03-29 | Spawn retry budget 2→5, progressive delay | #335 | ⚠️ More retries but still failing |
| v0.22.13 | 2026-03-29 | Lane-state reset on worker restart | #333 | ⚠️ Reset code runs but telemetry never flows |
| v0.22.13 | 2026-03-29 | Telemetry accumulation across restarts | #334 | ⚠️ Accumulation code correct but onTelemetry never fires |
| v0.22.13 | 2026-03-29 | Lane stderr capture to log file | #339 | ✅ Stderr now visible |
| v0.22.14 | 2026-03-29 | Stable sidecar identity per session | #354 | ⚠️ Path generated correctly but wrong file tailed (RC2, RC3) |
| v0.22.14 | 2026-03-29 | PID file for orphan cleanup | #242 | ⚠️ PID file not written when session dies early |
| v0.22.14 | 2026-03-29 | Artifact staging preserves STATUS.md | #356 | ✅ STATUS.md survives integration |
| v0.22.14 | 2026-03-29 | Artifact staging includes .reviews/** | — | ✅ Review files preserved |
| v0.22.14 | 2026-03-29 | Wave start message post-affinity lane count | #346 | ✅ Correct count shown |
| v0.22.14 | 2026-03-29 | Dashboard duplicate log fix | #348 | ✅ No more doubled entries |
| v0.22.14 | 2026-03-29 | Wiggum legacy cleanup | #251 | ✅ All references removed |
| v0.22.15 | 2026-03-29 | Lane `--no-extensions` to prevent duplicate loading | — | ✅ No more extension conflict |
| v0.22.16 | 2026-03-29 | Lane sidecar role `lane` not `worker` | — | ✅ No filename collision |
| v0.22.16 | 2026-03-29 | Pi stderr capture in exit summary | — | ✅ Revealed RC4 |
| v0.22.17 | 2026-03-29 | System prompt via file when >8K | — | ✅ But superseded by v0.22.18 |
| v0.22.18 | 2026-03-30 | Lean worker prompt (~500 chars) | — | ✅ Eliminates command line issue at source |

---

## 7. Test Results and Evidence

### Spawn Test Script (`scripts/tmux-spawn-test.mjs`)

Created to reproduce spawn failures without running batches. Results:

```
Simple commands (sleep, node):     100% success (20/20)
rpc-wrapper + pi (real prompts):   100% success (5/5) — manual
rpc-wrapper + pi (during batch):   0% success on first 5 attempts
```

### Exit Summary Evidence (v0.22.16+)

```json
{
  "exitCode": 1,
  "durationSec": 0,
  "toolCalls": 0,
  "error": "pi process exited with code 1\npi stderr: The command line is too long."
}
```

This revealed RC4 (command line length). After the lean prompt fix (v0.22.18), the crashes continue but with NO exit summary at all — rpc-wrapper never starts, so no file is written.

### tmux Fork Error (observed once)

```
0 [main] tmux 151226 dofork: child -1 - forked process 91956 died unexpectedly,
retry 0, exit code 0xC0000142, errno 11
```

`0xC0000142` = `STATUS_DLL_INIT_FAILED` — Windows DLL initialization failure during Cygwin/MSYS2 fork emulation.

---

## 8. Key Code Locations

### Spawn Path

```
extensions/taskplane/execution.ts
  buildTmuxSpawnArgs()          — builds lane tmux command
  spawnLaneSession()            — creates lane tmux session
  executeLane()                 — manages lane lifecycle

extensions/task-runner.ts
  spawnAgentTmux()              — creates worker/reviewer tmux sessions (line ~1831)
    - sidecar path resolution   — line ~1886 (stable vs internal)
    - tmux new-session          — line ~2016
    - spawn verify + retry      — line ~2038
    - poll loop (tail sidecar)  — line ~2110
  runWorker()                   — worker lifecycle (line ~3484)
    - stable sidecar generation — line ~3093
    - lean prompt construction  — line ~3530
  generateStableSidecarPaths()  — stable naming (line ~1597)

bin/rpc-wrapper.mjs
  parseArgs()                   — CLI arg parsing
  spawn pi process              — line ~773 (shell: true)
  sidecar event writing         — writeSidecarEvent()
  exit summary                  — writeExitSummary()
  PID file                      — line ~783
  stderr capture                — line ~940 (piStderrBuffer)
  system prompt file handling   — line ~762
```

### Telemetry Path

```
extensions/task-runner.ts
  tailSidecarJsonl()            — reads sidecar JSONL incrementally (line ~1420)
  onTelemetry callback          — accumulates into TaskState (line ~3662)
  writeLaneState()              — writes lane-state JSON for dashboard

extensions/taskplane/execution.ts
  generateTelemetryPaths()      — lane sidecar naming (line ~166)

dashboard/server.cjs
  loadLaneStates()              — reads lane-state JSON files
  /api/state endpoint           — serves to dashboard client
```

---

## 9. Environment Details

- **OS:** Windows 11 (MSYS2/Git Bash)
- **Node.js:** v25.8.0
- **Pi:** 0.63.2
- **tmux:** 3.x (MSYS2 package)
- **Shell:** Git Bash (MSYS2 /usr/bin/bash)
- **Project:** taskplane self-hosting (developing itself)
- **Auto-compaction:** OFF (pi settings)
- **Worker model:** anthropic/claude-opus-4-6 (1M context window)
- **Context pressure:** warn at 85%, kill at 95%
- **Max worker iterations:** configured default (typically 10)
- **Spawn retry budget:** 5 retries with progressive delay (500ms × attempt#)
- **Spawn verify delay:** 500ms initial, 3 polls × 200ms each

---

## 10. Next Steps

### Priority 1: Solve tmux Spawn Race Condition

The single remaining blocker. All other fixes are in place but don't help because the worker tmux session dies before any code runs.

**Most promising approach:** Stop using `tmux new-session` for workers. The worker communicates via stdin/stdout (RPC mode) and sidecar files — it doesn't need a terminal. Use `child_process.spawn()` directly from task-runner, which:
- Avoids tmux entirely for worker/reviewer processes
- Eliminates the MSYS2 fork issue
- Gives direct process control (PID, signals, exit code)
- Makes orphan detection trivial (the process IS the child)

The lane session still needs tmux (it's spawned by the engine which runs in a worker_thread). But workers/reviewers spawned by task-runner inside the lane don't.

**Tradeoff:** Losing `tmux attach` for worker debugging. But this doesn't work anyway — the worker session dies or becomes an orphan. The sidecar JSONL + stderr log provide better debugging than a dead tmux pane.

### Priority 2: Validate Telemetry Pipeline End-to-End

Once spawns work reliably, verify:
- Worker sidecar JSONL is created at the stable path
- task-runner tails it correctly (onTelemetry fires)
- Lane-state JSON updates with real context %, tools, cost
- Dashboard displays the values
- Context pressure triggers at 85%

### Priority 3: Lane Session Context Conservation

The lane's pi session accumulates context from extension processing. With the lean worker prompt, the lane does less work upfront. But spawn retries, reviewer management, and polling still consume context. Consider:
- Enabling auto-compaction for the lane session
- Moving deterministic orchestration out of the pi session (pure Node.js)
- Reducing the lane prompt to the absolute minimum
