# Code Review — TP-090 Step 1 (Steering-pending flag and STATUS.md injection)

## Verdict: REVISE

## Scope reviewed
Diff base: `838035fa7aee62ca85640022130e5d6d8768a012..HEAD`

Changed implementation files reviewed in full:
- `bin/rpc-wrapper.mjs`
- `extensions/task-runner.ts`
- `templates/agents/task-worker.md`

Neighbor/pattern checks:
- `docs/specifications/taskplane/agent-mailbox-steering.md`
- `extensions/tests/rpc-wrapper.test.ts`
- `extensions/tests/task-runner-rpc.test.ts`

Validation run:
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/rpc-wrapper.test.ts tests/task-runner-rpc.test.ts`
- Result: **1 failing test** (details below)

---

## Findings

### 1) Steering row timestamp is not using the delivered message timestamp
- **Severity:** Medium
- **File:** `extensions/task-runner.ts` (around lines 2999-3003)
- **Issue:**
  The code parses `entry.ts` and computes `ts`, but then calls `logExecution(...)`, which always uses `new Date()` internally. So the execution-log row timestamp is the poll-time timestamp, not the message timestamp from `.steering-pending`.
- **Why it matters:**
  The step/spec contract for injection is `| {timestamp} | ⚠️ Steering | {content} |` based on delivered message details. Current behavior loses delivery-time fidelity and can mis-order audit chronology.
- **Suggested fix:**
  Write the row via `appendTableRow(...)` (or a timestamp-aware helper) using the parsed `entry.ts` value directly.

### 2) Step change introduces a regression in existing task-runner RPC tests
- **Severity:** Medium
- **Files:**
  - Triggered by: `extensions/task-runner.ts` (new `steeringPendingPath?: string` in `spawnAgentTmux` options block)
  - Failing test: `extensions/tests/task-runner-rpc.test.ts:349`
- **Issue:**
  The test slices only 1200 chars from `function spawnAgentTmux(` and expects `sidecarPath:`/`exitSummaryPath:` to be inside that window. Adding the new option pushed those strings beyond the fixed slice window.
- **Why it matters:**
  Current suite contains a failing test after this step, which blocks clean verification.
- **Suggested fix:**
  Update the brittle test extraction logic (prefer `extractFunctionRegion(...)` in this case, or increase/remove fixed slice limit).

---

## What looks good
- `rpc-wrapper` argument threading for `--steering-pending-path` is clean and backward-compatible.
- Worker-only wiring in task-runner is correctly scoped.
- JSONL append/read design for multi-message delivery in one iteration is deterministic.
- Message sanitization (`newline` collapse + `|` escape + truncation) is appropriate for markdown table safety.
- Worker template guidance on steering behavior is clear and actionable.
