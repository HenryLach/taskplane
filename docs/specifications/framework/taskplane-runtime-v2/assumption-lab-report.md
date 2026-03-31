# Runtime V2 Assumption Lab Report

**Status:** Completed exploratory validation  
**Date:** 2026-03-30  
**Task:** `TP-110`  
**Harness:** `scripts/runtime-v2-lab/`  
**Raw summary:** `scripts/runtime-v2-lab/out/latest-summary.json`

## 1. Goal

Validate the highest-risk Runtime V2 architectural assumptions **outside the
current TMUX- and `/task`-based production path** before the main refactor
proceeds.

## 2. Baseline and scope

### Runtime baseline selected

- **Session-attached but resumable**

This lab does **not** attempt detached/background execution.

### Out of scope for this lab

- full wave/batch orchestration
- dashboard SSE integration
- merge orchestration parity
- dynamic segment expansion
- full bridge callback semantics

## 3. Environment

- **Repo:** `C:/dev/taskplane`
- **Node:** `v25.8.0`
- **Pi:** `0.64.0` (`pi --version`)
- **Platform:** Windows host environment (current Taskplane development environment)

## 4. Harness design

The lab uses a standalone direct-child host that:

- resolves Pi's underlying CLI entrypoint directly
- spawns `node <pi-cli> --mode rpc --no-session` with **no TMUX**
- parses RPC JSONL directly from stdout
- optionally queries `get_session_stats`
- optionally injects mailbox messages through RPC `steer`
- records raw outcomes to `scripts/runtime-v2-lab/out/latest-summary.json`

### Important preflight observation

On this Windows environment, `pi` resolves to an npm shim (`pi.cmd`).
For Runtime V2, the host should **not** depend on spawning the shim as though it
were a native binary. It should resolve the underlying CLI entrypoint and invoke
Node directly (or an equivalent non-TMUX/non-pane-dependent path).

## 5. Experiments run

## E1 — Direct-child close strategy

### Question

Can a direct child host run Pi RPC sessions and exit cleanly without TMUX?

### Result

- direct-host sessions exited cleanly in the final harness configuration
- direct `contextUsage` capture also succeeded in the delayed-close path

### Interpretation

The transport is viable.

### Exploratory caution

During early ad hoc probing outside the final harness, I observed a Windows-side
assertion failure when the host closed stdin too aggressively after `agent_end`
while extra RPC interaction was still happening. I did **not** reproduce this in
the final harness summary run, but it is enough evidence to keep one design
rule:

> Runtime V2 host shutdown should be centralized and conservative. Do not assume
> that closing stdin immediately after `agent_end` is always safe under all
> argument mixes and in-flight RPC conditions.

## E2 — Sequential and limited-parallel direct spawn reliability

### Question

Can a no-TMUX direct host reliably run simple Pi RPC sessions in sequence and in
small parallel sets?

### Result

From `latest-summary.json`:

- **Sequential:** 5/5 successful
- **Parallel:** 3/3 successful
- all successful runs captured `contextUsage`
- no stderr crash signatures were recorded in the successful runs

### Interpretation

This is strong evidence that the **core no-TMUX direct-child hosting model is
viable** for Runtime V2 on this machine, at least for simple prompts.

### Constraint

This does **not** prove that long, tool-heavy, multi-turn execution is fully
stable yet. It proves the transport layer is promising enough to justify the
refactor.

## E3 — Direct RPC telemetry / authoritative context usage

### Question

Can a direct host capture useful runtime telemetry without sidecar tailing
between sibling processes?

### Result

Yes.

The host was able to:

- parse RPC JSONL directly from stdout
- identify message boundaries and tool events
- call `get_session_stats`
- receive `contextUsage`

### Interpretation

This validates a key Runtime V2 assumption:

> live control/telemetry can flow directly between parent and child rather than
> being reconstructed by file polling between siblings.

That does **not** remove the value of persisted event logs; it only means disk
should be the **durable audit layer**, not the primary live transport for
parent/child state.

## E4 — Mailbox steering without TMUX

### Question

Does the mailbox + `steer` RPC model still work when the agent is direct-hosted
instead of living inside TMUX?

### Result

Yes.

Observed outcome:

- prewritten mailbox message delivered successfully
- inbox message moved to `ack/`
- assistant responded first with `READY`
- after steering injection, assistant responded with `STEER-ACK`

### Interpretation

This validates a major Runtime V2 architectural bet:

> Supervisor → mailbox → agent-host → Pi RPC `steer` works without TMUX.

This is the strongest evidence that the user-facing operator model can become:

- operator talks only to supervisor
- supervisor steers agents
- dashboard shows message lifecycle

with **no direct terminal interaction requirement**.

## E5 — Explicit packet-path / `cwd != packet home`

### Question

Can a direct-hosted agent reliably operate when the execution cwd differs from
the packet home location?

### Result

**Not yet validated in a reproducible way.**

In the final summary run:

- packet-path experiment attempts: **2**
- successes: **0**
- both attempts timed out without completing tool work

### Important nuance

Before the final repeatable harness run, I did obtain an **ad hoc successful
probe** where a direct-hosted agent:

- ran with `cwd` in an execution repo directory
- read packet files from a separate packet-home directory
- wrote `.DONE` into the packet-home directory
- finished successfully

However, because the repeatable harness did **not** reproduce that success, I am
not counting this assumption as validated yet.

### Interpretation

The result is best classified as:

- **conceptually promising**
- **operationally still open**

This does **not** mean explicit packet paths are a bad design. It means we do
not yet have enough reliable evidence from the lab harness to treat the prompt-
level tool sequence as proven.

### Implication for the roadmap

Packet-path authority should still be implemented as a **contract-level
foundation** (TP-102), but Runtime V2 should not treat packet-home execution
behavior as fully de-risked until a dedicated proof lands during the execution
slice work.

## E6 — Minimal bridge-style callback

### Question

Can we already claim that bridge-style request/response callbacks are proven for
Runtime V2?

### Result

**Open. Not validated in this first lab run.**

The lab recorded this explicitly as still open.

### Interpretation

Bridge semantics should remain a planned area of work for:

- `TP-105` (lane-runner slice)
- `TP-106` (mailbox/bridge control work)

It would be premature to declare bridge callbacks solved from the current lab.

## 6. Additional exploratory finding: thinking-mode compatibility is model-specific

During ad hoc probing, I observed a provider/model-side error when passing a
blanket `--thinking off` style override under one default model path:

- the model rejected an unsupported "none"-style thinking value

This matters because current Taskplane runtime code often assumes worker/reviewer
thinking overrides can be pushed mechanically.

### Interpretation

Runtime V2 should avoid a naive assumption that one universal thinking override
is valid across all models/providers. The new host/runtime should either:

- rely on compatible configured values only, or
- validate/normalize thinking settings per model path

## 7. Summary table

| Assumption | Result | Confidence |
|---|---|---|
| Direct child spawning without TMUX is viable | **Validated** | Medium-high |
| Direct RPC telemetry + `contextUsage` capture is viable | **Validated** | High |
| Mailbox steering without TMUX is viable | **Validated** | High |
| Explicit packet-home paths work reliably in repeatable harness runs | **Open / partial** | Low |
| Minimal bridge callback semantics are proven | **Open** | Low |
| Session-attached but resumable baseline is reasonable | **Validated for current scope** | High |

## 8. Recommendations before TP-102+ proceeds

## Proceed now

I recommend proceeding with:

- **TP-102** — Runtime V2 contracts
- **TP-103** — executor-core extraction
- **TP-104** — direct host + registry

These are justified by the validated transport, telemetry, and mailbox results.

## Proceed, but with explicit caution

For **TP-105** and later execution-slice work:

1. keep direct-host transport as the foundation
2. keep mailbox-first steering as the control model
3. add a **dedicated packet-path proof checkpoint** before treating workspace
   packet-home behavior as solved
4. treat bridge semantics as an explicit design/proof item, not an assumed freebie

## Host implementation rules now justified by the lab

1. **No TMUX in the correctness path**
2. **Direct stdout RPC parsing is sufficient for live control**
3. **Use mailbox + `steer` for supervisor control**
4. **Do not rely on the Windows npm shim as the host abstraction**
5. **Centralize shutdown and avoid over-eager stdin close assumptions**
6. **Do not assume one universal thinking override is safe across providers/models**

## 9. Suggested roadmap adjustments

### Add a Phase 0 gate to Runtime V2 rollout

Treat TP-110 as the pre-refactor gate before core implementation tasks.

### Keep packet-path authority early, but treat runtime proof separately

- keep TP-102 packet-path contracts early
- keep TP-109 as the real workspace/runtime proof point
- do not declare packet-home execution behavior validated from architecture alone

### Keep bridge work explicit

Do not fold bridge assumptions into vague “runtime glue.”
Make them concrete in TP-105 / TP-106.

## 10. Final judgment

The lab result is a **qualified green light**.

### Green-lighted foundations

- no-TMUX direct-child hosting
- direct RPC telemetry capture
- mailbox steering as the canonical supervisor control path
- session-attached but resumable Runtime V2 baseline

### Still-open risks

- repeatable packet-home execution proof in the harness
- bridge callback proof
- behavior of tool-heavy multi-step prompts under the current default model path

That is enough confidence to continue Runtime V2 foundation work — but not
enough to skip explicit packet-path and bridge validation in the early
implementation tasks.
