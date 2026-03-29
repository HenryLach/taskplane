# TMUX Mode Telemetry Gap

> **Status:** ⚠️ SUPERSEDED — consolidated into [resilience-and-diagnostics-roadmap.md](resilience-and-diagnostics-roadmap.md) on 2026-03-19.  
> The RPC wrapper solution (Section 4.6 of this doc) is Phase 1 of the consolidated roadmap.  
> This file is retained for historical reference.
>
> **Historical note (testing):** Vitest command references are legacy context.
> Current Taskplane test execution uses Node.js native `node:test`.
>
> **Created:** 2026-03-18  
> **Related:** [resilience-architecture.md](resilience-architecture.md) (Section 18)

---

## 1. Problem

The task-runner has two spawn modes for workers and reviewers:

| Capability | Subprocess Mode | TMUX Mode |
|------------|:-:|:-:|
| Exit code | ✅ | ❌ (hardcoded 0) |
| Error output | ✅ | ❌ (empty string) |
| Token counts (input/output/cache) | ✅ | ❌ |
| Context utilization % | ✅ | ❌ |
| Per-tool-call telemetry | ✅ | ❌ |
| Cost tracking | ✅ | ❌ |
| Context-based wrap-up signal | ✅ (at warn%) | ❌ (wall-clock only) |
| Live session visibility (attachable) | ❌ | ✅ |

Subprocess mode gets all telemetry because pi's JSON event stream flows through
stdout, which the task-runner reads as a child process stream. TMUX mode loses
all of it because stdout goes to the tmux terminal emulator.

---

## 2. Where Each Mode Is Actually Used

### `/orch` (orchestrated batches)

The orchestrator **always** uses subprocess mode for workers/reviewers, regardless
of the `spawn_mode` config setting:

```
execution.ts line 135:
  TASK_RUNNER_SPAWN_MODE: "subprocess",  // hardcoded
```

The architecture is:
```
tmux session (orch-{opId}-lane-{N})     ← visible, attachable
  └─ pi (task-runner extension)          ← runs inside tmux
       ├─ subprocess: pi worker          ← JSON stream → full telemetry
       └─ subprocess: pi reviewer        ← JSON stream → full telemetry
```

This gives **both** visibility (attach to lane session) **and** telemetry
(subprocess JSON stream). The tmux session is for the task-runner process,
not for the worker/reviewer.

### `/task` (single task execution)

Controlled by `spawn_mode` config (default: `subprocess`):

- **subprocess:** Worker/reviewer run as child processes of the pi session.
  Full telemetry. No separate tmux session to attach to.
- **tmux:** Worker/reviewer run in named tmux sessions (`task-worker`,
  `task-reviewer`). Attachable for debugging. No telemetry.

The user sets tmux mode specifically for live debugging — `tmux attach -t task-worker`.

---

## 3. Why This Matters

When a TMUX-mode worker session crashes (in `/task` mode), the operator gets:
```
TMUX session 'task-worker' exited without creating .DONE file
(grace period 5000ms expired). Last output: [startup banner]
```

No way to determine:
- Was it an API error? (auth, rate limit, overloaded)
- Did it hit context limits?
- Did pi crash? (unhandled exception, OOM)
- What was the exit code?
- How many tokens were used?
- What was the last thing it was doing?

For `/orch`, this is less of an issue because workers run as subprocesses with
full telemetry. But the diagnostic gap still affects:
- Users who prefer `/task` with tmux mode for visibility
- Future scenarios where we might want tmux-level visibility in orch lanes

---

## 4. Possible Solutions

### 4.1 Pi Sidecar Telemetry File (Best Option)

Pi would support a `--telemetry-file <path>` flag. When set, pi writes the same
JSON events it sends on stdout to a JSONL file:

```bash
pi -p --telemetry-file /tmp/pi-telemetry-abc123.jsonl \
  --model anthropic/claude-sonnet-4-20250514 \
  --append-system-prompt system.txt \
  @prompt.txt
```

The file accumulates events:
```jsonl
{"type":"tool_call","name":"read","args":{"path":"STATUS.md"},"ts":1773834000}
{"type":"token_update","input":1200,"output":500,"cacheRead":45000,"ts":1773834001}
{"type":"context_pct","pct":23.5,"ts":1773834001}
{"type":"message_end","exitCode":0,"ts":1773834500}
```

**Task-runner integration:**
1. Generate a temp telemetry file path before spawning
2. Pass `--telemetry-file` to the pi command in tmux
3. Tail the file during execution for live telemetry
4. Read final state after session exits for diagnostics

**Pros:**
- Clean separation — pi owns the format, task-runner consumes it
- Works in any spawn context (tmux, subprocess, remote)
- No stdout plumbing changes
- Backward compatible (flag is optional)

**Cons:**
- Requires a pi change (new flag)
- File I/O overhead (minimal)

**Status:** Requires pi feature request / contribution.

### 4.2 Wrapper Script with `tee` (Fragile Workaround)

Pipe pi's stdout through `tee` to capture events while displaying in tmux:

```bash
pi -p ... 2>&1 | tee /tmp/pi-events.jsonl
```

**Pros:** No pi changes needed.  
**Cons:** Fragile on Windows/MSYS2. Breaks interactive TUI. `tee` captures
rendered terminal output, not structured JSON. Not viable.

### 4.3 Exit Code Capture via Wrapper (Partial Fix)

Wrap the pi command to capture exit code:

```bash
pi -p ...; echo $? > /tmp/pi-exit-code.txt
```

Or equivalently:
```bash
tmux new-session -d -s worker 'pi -p ... ; echo "EXIT:$?" > /tmp/exit.txt'
```

**Pros:** Simple, no pi changes.  
**Cons:** Only captures exit code, not telemetry. Doesn't work if pi is killed
by signal (no chance to write file). Partial solution at best.

### 4.4 Named Pipe / Unix Socket (Unix Only)

Pi writes events to a unix socket or named pipe. Task-runner connects and reads.

**Pros:** Real-time streaming without file I/O.  
**Cons:** Unix only — no Windows/MSYS2 support. Complex setup. Not practical
for our Windows-primary user base.

### 4.5 Eliminate TMUX Worker Mode (Simplification)

Since `/orch` already uses subprocess mode for workers inside a tmux lane
session, and this gives both visibility AND telemetry, we could:

1. Remove `spawn_mode` config entirely (always subprocess)
2. For `/task` visibility, auto-create a tmux session that runs the task-runner
   (same pattern as `/orch` lanes), with workers as subprocesses inside it

This would give `/task` the same architecture as `/orch`:
```
tmux session (task-runner)           ← visible, attachable
  └─ pi (task-runner extension)
       ├─ subprocess: pi worker      ← full telemetry
       └─ subprocess: pi reviewer    ← full telemetry
```

**Pros:**
- No pi changes needed
- Eliminates the telemetry gap entirely
- Simplifies code (one spawn path)
- `/task` and `/orch` use the same worker management model

**Cons:**
- Can't attach to the worker pi session directly (only the task-runner session)
- Removes the ability to watch raw worker output in real-time
- Breaking change for users who rely on `tmux attach -t task-worker`

**Assessment:** This is the most pragmatic option if sidecar telemetry (4.1)
isn't available from pi. The debugging value of attaching to a raw worker session
is marginal — the task-runner's dashboard already shows progress, and the
lane tmux session shows the task-runner's own UI.

---

### 4.6 RPC Mode (Best Option — No Pi Changes Needed)

Pi already supports `--mode rpc` which provides a full JSON protocol over
stdin/stdout. Instead of spawning `pi -p` (print mode, fire-and-forget), the
task-runner could spawn `pi --mode rpc` and communicate via the structured
protocol.

**What RPC mode provides:**
- `message_end` events with full token usage (`input`, `output`, `cacheRead`,
  `cacheWrite`, `cost`)
- `tool_execution_start/update/end` events for per-tool telemetry
- `auto_retry_start/end` events — tells us exactly when API errors occur
  (overloaded, rate limit, 5xx) and whether retries succeeded
- `auto_compaction_start/end` — tells us when context is nearly full
- `agent_end` event with all generated messages
- `get_session_stats` command for cumulative token/cost stats
- `abort` command for clean cancellation
- Structured error responses with error messages
- Exit codes via process exit

**Architecture with RPC in tmux:**

The task-runner would spawn a wrapper process inside the tmux session that:
1. Starts `pi --mode rpc` as a child process
2. Sends the `prompt` command via stdin
3. Reads events from stdout, writes telemetry to a sidecar JSONL file
4. Displays a simplified progress view in the tmux pane (optional)
5. On exit, writes a final summary file with exit classification

```
tmux session (task-worker)                 ← visible, attachable
  └─ rpc-wrapper.mjs                      ← thin wrapper
       └─ pi --mode rpc --no-session       ← full event stream
            ├─ events → sidecar.jsonl      ← task-runner tails this
            └─ display → tmux pane         ← operator can watch
```

Alternatively, even simpler — the task-runner doesn't need to read telemetry
in real-time. The wrapper just accumulates events and writes a summary on exit:

```json
{
  "exitCode": 0,
  "tokens": { "input": 45000, "output": 12000, "cacheRead": 180000, "cacheWrite": 5000, "cost": 0.52 },
  "contextPct": 23.5,
  "toolCalls": 47,
  "retries": [{ "attempt": 1, "error": "529 overloaded", "delayMs": 2000 }],
  "compactions": 0,
  "durationSec": 847,
  "error": null
}
```

**Pros:**
- No pi changes needed — RPC mode already exists and is stable
- Full telemetry including retries, compactions, errors
- Works in any spawn context (tmux, subprocess, remote)
- Can still display in tmux pane for visibility
- Clean abort via `abort` command (no kill signal needed)
- Session stats available on demand via `get_session_stats`

**Cons:**
- Requires a wrapper script (thin Node.js process)
- Slightly more complex spawn setup than `pi -p`
- Need to handle the extension UI sub-protocol (select/confirm dialogs) —
  though in headless mode these can auto-resolve with defaults

**Key RPC events for diagnostics:**

| Event | What it tells us |
|-------|-----------------|
| `auto_retry_start` | API error type (overloaded, rate limit, 5xx), retry count |
| `auto_retry_end` | Whether retry succeeded or final failure |
| `auto_compaction_start/end` | Context pressure (overflow vs threshold) |
| `message_end.usage` | Per-turn token counts and cost |
| `tool_execution_end.isError` | Tool failures |
| `agent_end` | Clean completion with all messages |
| Process exit code | Crash vs clean exit |

**Assessment:** This is clearly the best path forward. RPC mode was designed
for exactly this use case — embedding pi in other applications. It gives us
everything the subprocess JSON stream provides, plus more (retry events,
compaction events, session stats). The wrapper script is trivial.

---

## 5. Recommendation

**Revised recommendation (after RPC mode discovery):**

**Primary path: RPC mode wrapper (4.6)**
- Build a thin `rpc-wrapper.mjs` that spawns `pi --mode rpc`, sends the prompt,
  accumulates events, and writes a summary file on exit
- Task-runner reads the summary file after session exit for full diagnostics
- This works in both tmux and subprocess mode, unifying the spawn paths
- No pi changes needed — RPC mode is production-ready

**Short-term (immediate):**
- Implement 4.3 (exit code wrapper) as a quick stopgap
- Can be replaced by RPC wrapper later

**Simplification (optional):**
- Consider 4.5 (eliminate tmux worker mode) since `/orch` already proves
  the task-runner-in-tmux pattern works
- RPC mode may make this unnecessary since we get full telemetry either way

---

## 6. Real-Time Dashboard Telemetry

### 6.1 Architecture

The RPC wrapper writes events to a sidecar JSONL file as they arrive. The
task-runner's existing poll loop (every `poll_interval` seconds, default 5s)
reads new lines from the file and pushes metrics to the dashboard.

```
tmux session (orch-{opId}-lane-{N}-worker)
  └─ rpc-wrapper.mjs
       └─ pi --mode rpc
            │
            ├─ message_end      → .pi/lane-telemetry-{opId}-lane-{N}.jsonl
            ├─ tool_exec_end    → .pi/lane-telemetry-{opId}-lane-{N}.jsonl
            ├─ auto_retry_start → .pi/lane-telemetry-{opId}-lane-{N}.jsonl
            ├─ auto_retry_end   → .pi/lane-telemetry-{opId}-lane-{N}.jsonl
            ├─ auto_compact_end → .pi/lane-telemetry-{opId}-lane-{N}.jsonl
            └─ agent_end        → .pi/lane-telemetry-{opId}-lane-{N}.jsonl

task-runner (poll loop)
  ├─ reads STATUS.md       → checkbox progress
  ├─ tails telemetry JSONL → token counts, cost, tools, retries
  └─ pushes to dashboard   → near-real-time updates
```

### 6.2 Dashboard Metrics (Target)

| Metric | Source Event | Update Frequency |
|--------|-------------|-----------------|
| Tokens (input/output/cache) | `message_end.usage` | Every LLM turn (~30-60s) |
| Cost ($) | `message_end.usage.cost` | Every LLM turn |
| Context utilization % | Computed from cumulative tokens vs model context window | Every LLM turn |
| Last tool call | `tool_execution_start` | Every tool call (~5-15s) |
| Tool call count | Accumulated `tool_execution_end` | Every tool call |
| Active retries | `auto_retry_start/end` | On retry events |
| Compaction events | `auto_compaction_end` | On compaction |
| Worker iteration | Task-runner internal state | On iteration boundary |
| Step progress | STATUS.md checkboxes | Every poll interval |

### 6.3 Cost Accuracy Requirement

The dashboard cost metric must include **all** token expenditure for the batch,
not just worker turns. A batch incurs costs from multiple sources:

| Cost Source | Currently Tracked? | Notes |
|-------------|:-:|-------|
| Worker LLM turns | ✅ (subprocess) / ❌ (tmux) | Primary cost — bulk of tokens |
| Reviewer LLM turns | ✅ (subprocess) / ❌ (tmux) | Cross-model review calls |
| Merge agent LLM turns | ❌ | Merge agents run in separate tmux sessions |
| Auto-compaction LLM calls | ❌ | Compaction itself calls the LLM to summarize |
| Auto-retry duplicate calls | ❌ | Retried turns consume tokens even if they fail |
| Dependency analysis (agent mode) | ❌ | When `dep_source: agent`, LLM analyzes tasks |

**Goal:** The dashboard's "Batch Cost" number should be the **true total cost**
of running the batch — the number the operator would see on their API billing.
Any untracked cost source makes the metric misleading.

**Implementation path:**
1. RPC wrapper captures all `message_end.usage` events including retries and
   compactions (these are already included in the RPC event stream)
2. Merge agent telemetry needs the same RPC wrapper treatment
3. Reviewer telemetry: already captured in subprocess mode, needs RPC wrapper
   in tmux mode
4. Dependency analysis: needs instrumentation if using agent mode

### 6.4 Telemetry JSONL Format

Each line in the sidecar file is a JSON object with a `type` field matching
the pi RPC event type, plus a `ts` timestamp:

```jsonl
{"type":"message_end","ts":1773834100,"usage":{"input":1200,"output":500,"cacheRead":45000,"cacheWrite":0,"cost":{"total":0.0142}}}
{"type":"tool_execution_start","ts":1773834102,"toolName":"bash","args":{"command":"cd extensions && npx vitest run"}}
{"type":"tool_execution_end","ts":1773834115,"toolName":"bash","isError":false}
{"type":"auto_retry_start","ts":1773834200,"attempt":1,"maxAttempts":3,"delayMs":2000,"errorMessage":"529 overloaded"}
{"type":"auto_retry_end","ts":1773834205,"success":true,"attempt":1}
{"type":"message_end","ts":1773834210,"usage":{"input":1400,"output":600,"cacheRead":46000,"cacheWrite":0,"cost":{"total":0.0168}}}
```

The task-runner tracks its read offset into the file (byte position or line
count) and only reads new lines on each poll. This is O(new events) per poll,
not O(total events).

### 6.5 Session Exit Summary

On process exit, the wrapper writes a final summary file alongside the JSONL:

```
.pi/lane-exit-{opId}-lane-{N}.json
```

```json
{
  "exitCode": 0,
  "exitSignal": null,
  "tokens": {
    "input": 45000,
    "output": 12000,
    "cacheRead": 180000,
    "cacheWrite": 5000
  },
  "cost": 0.52,
  "toolCalls": 47,
  "retries": [
    { "attempt": 1, "error": "529 overloaded", "delayMs": 2000, "succeeded": true }
  ],
  "compactions": 1,
  "durationSec": 847,
  "lastToolCall": "bash: cd extensions && npx vitest run",
  "error": null,
  "classification": "completed"
}
```

The `classification` field uses the taxonomy from resilience spec Section 18.4.3.
The task-runner reads this file after the tmux session exits to determine the
structured exit reason — replacing the current "session exited without .DONE"
black box.

---

## 7. Open Questions

1. Should the RPC wrapper display progress in the tmux pane, or keep it minimal?
   A lightweight progress display (step, iteration, last tool, tokens) would
   give the attachable tmux session real debugging value beyond just "pi is running".
2. How should extension UI requests (select/confirm) be handled in the wrapper?
   Auto-resolve with defaults? Forward to task-runner? Workers shouldn't need
   interactive UI, but extensions might trigger dialogs unexpectedly.
3. Should we use RPC mode for subprocess spawning too (replacing the current
   `spawnAgent()` JSON stream), for a single unified spawn path? This would
   eliminate the subprocess vs tmux telemetry divergence entirely.
4. Would eliminating tmux worker mode (4.5) break any real user workflows,
   or does the RPC wrapper make it unnecessary to decide?
5. Performance: is the RPC wrapper overhead meaningful for short-lived workers?
6. Should merge agents also use the RPC wrapper? They currently run as bare
   `pi -p` in tmux sessions with zero telemetry — same gap as workers.
7. How do we attribute cost per-task when multiple tasks run sequentially in
   the same lane? The sidecar file is per-lane, not per-task. Need task
   boundaries in the telemetry stream (or separate files per task).
8. Should the dashboard show per-wave cost breakdowns or just batch totals?
