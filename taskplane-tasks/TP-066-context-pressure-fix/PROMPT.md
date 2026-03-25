# Task: TP-066 - Fix Context Pressure Safety Net

**Created:** 2026-03-25
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Fixes a critical safety mechanism (context pressure wrap-up/kill) that silently fails when cache tokens dominate. Also adds worker template guidance to prevent context bloat. Medium blast radius — touches telemetry parsing, context calculation, and worker template.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-066-context-pressure-fix/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

The context pressure safety net (85% warn → wrap-up signal, 95% → kill) silently fails when cache read tokens dominate the context. This was discovered when TP-065's worker consumed 874K tokens across 3 consecutive attempts without ever triggering the 85% wrap-up signal.

**Root cause:** `latestTotalTokens` in the telemetry delta is calculated as `usage.totalTokens || (usage.input + usage.output)`. Neither branch includes cache read tokens. With Anthropic's prompt caching, a worker can have 50K input + 20K output but 800K cache reads — the safety net sees 7% instead of ~87%.

**Two fixes needed:**
1. Include cache reads in context pressure calculation
2. Add worker template guidance for targeted file reading (prevent context bloat at the source)

## Real-World Failure (2026-03-25, TP-065)

```
Worker attempt 1: 874K tokens, 39 tools, exitCode 0 — no wrap-up signal
Worker attempt 2: resumed, same pattern — no progress, no wrap-up
Worker attempt 3: resumed again — same result
Dashboard showed ~13% context throughout — wildly inaccurate
```

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — search for `latestTotalTokens` (~line 1283-1390) for telemetry delta calculation, and `warnPct` (~line 3070-3085) for tmux mode context pressure handling
- `templates/agents/task-worker.md` — current worker instructions, find where to add file reading guidance
- `bin/rpc-wrapper.mjs` — search for `totalTokens` to understand what the RPC wrapper reports from pi's usage data

## Environment

- **Workspace:** `extensions/`, `templates/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `bin/rpc-wrapper.mjs`
- `templates/agents/task-worker.md`
- `templates/agents/local/task-worker.md`
- `extensions/tests/context-window.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `latestTotalTokens` calculation in `task-runner.ts` (~line 1383-1388) — understand what's counted
- [ ] Read the tmux mode context pressure handler (~line 3070-3085) — understand how pct is used
- [ ] Read the RPC wrapper's usage reporting in `bin/rpc-wrapper.mjs` — search for `totalTokens` to see what pi reports in `message_end` events
- [ ] Determine: does `usage.totalTokens` from pi include cache reads? Or is it input+output only?

### Step 1: Fix Context Percentage Calculation

The core fix: include cache read tokens in the context pressure calculation.

**Option A (preferred): Fix at the delta calculation point**

In `task-runner.ts` where `latestTotalTokens` is computed from the sidecar telemetry (~line 1383):

```typescript
// Current (broken):
const totalTokens = usage.totalTokens
    || ((usage.input || 0) + (usage.output || 0));

// Fixed: include cache reads in context consumption
const totalTokens = usage.totalTokens
    || ((usage.input || 0) + (usage.output || 0) + (usage.cacheRead || 0));
```

BUT FIRST: check what `usage.totalTokens` actually includes when reported by pi. If pi's `totalTokens` already includes cache reads, then the issue is only in the fallback branch. If pi's `totalTokens` does NOT include cache reads, both branches need fixing:

```typescript
// If totalTokens from pi excludes cache reads:
const rawTotal = usage.totalTokens
    || ((usage.input || 0) + (usage.output || 0));
const totalTokens = rawTotal + (usage.cacheRead || 0);
```

**Also fix the same pattern in:**
- The subprocess mode context calculation (search for similar `totalTokens` in the subprocess `onContextPct` handler)
- The dashboard server's `loadTelemetryData` accumulator (search for `latestTotalTokens` in `dashboard/server.cjs`)

**Option B: Fix at the RPC wrapper level**

If the RPC wrapper computes `totalTokens` before emitting the event, fix it there so all consumers get the right number. Check `bin/rpc-wrapper.mjs` for where usage is reported.

Investigate both options in preflight, pick the one that fixes all consumers with minimal changes.

**Artifacts:**
- `extensions/task-runner.ts` (modified)
- `bin/rpc-wrapper.mjs` (possibly modified)
- `dashboard/server.cjs` (possibly modified)

### Step 2: Add Worker Template Guidance for Large Files

Add a "File Reading Strategy" section to `templates/agents/task-worker.md`:

**Key guidance:**
- For files over ~2000 lines, use `grep` or `bash` to locate relevant functions/sections first
- Use `read` with `offset` and `limit` parameters to view only the relevant region
- Never read an entire large file into context — it wastes context budget and risks exhaustion
- When modifying a specific function, read just that function (grep for it, note the line number, read 50-100 lines around it)
- If you need to understand a file's overall structure, use `grep -n "^function\|^export\|^class\|^interface"` to get an outline

**Example pattern:**
```
# Find the function you need to modify
bash: grep -n "function buildSupervisorSystemPrompt" extensions/taskplane/supervisor.ts
# Read just that region
read: extensions/taskplane/supervisor.ts (offset: 1773, limit: 50)
# Make surgical edit
edit: extensions/taskplane/supervisor.ts (oldText → newText)
```

**Artifacts:**
- `templates/agents/task-worker.md` (modified)
- `templates/agents/local/task-worker.md` (modified — update comments)

### Step 3: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite.

- [ ] Update `extensions/tests/context-window.test.ts` with:
  - Context % calculation includes cache read tokens
  - Verify the threshold triggers at correct percentages with cache-heavy workloads
  - Source-based tests for the fixed calculation in both tmux and subprocess modes
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None beyond template changes

**Check If Affected:**
- `docs/explanation/execution-model.md` — mentions context window, may want to note cache token inclusion

## Completion Criteria

- [ ] Context pressure calculation includes cache read tokens
- [ ] 85% wrap-up signal fires correctly with cache-heavy workloads
- [ ] 95% kill fires correctly with cache-heavy workloads
- [ ] Worker template instructs targeted file reading for large files
- [ ] Dashboard context % reflects actual context consumption including cache
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `fix(TP-066): complete Step N — description`

## Do NOT

- Change the 85%/95% threshold values
- Change the context window auto-detect logic (that's correct)
- Remove cache token tracking from telemetry (it's useful data)
- Make the worker template overly restrictive — agents should still read full small files

---

## Amendments
