# Task: TP-142 - Segment Expansion Tool and File IPC

**Created:** 2026-04-05
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** New RPC tool in bridge extension + file IPC contract. Touches agent-bridge-extension and types. Isolated from engine internals.
**Score:** 4/8 — Blast radius: 1 (bridge extension, types), Pattern novelty: 2 (new tool + file IPC pattern), Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-142-segment-expansion-tool-and-ipc/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Implement the `request_segment_expansion` RPC tool that workers use to request new segments at runtime, and the file IPC contract for communicating expansion requests to the engine.

This is the worker-facing half of dynamic segment expansion. The tool validates requests, writes structured request files to the agent's mailbox outbox, and returns acknowledgment. The engine consumes these files in TP-143.

**Implementation spec:** `docs/specifications/taskplane/dynamic-segment-expansion.md`

## Dependencies

- None (can be developed and tested in isolation — the engine consumption is TP-143)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `docs/specifications/taskplane/dynamic-segment-expansion.md` — the full spec (sections 0, 1, 2)
- `extensions/taskplane/agent-bridge-extension.ts` — existing tool registration pattern (reply_to_supervisor, review_step)
- `extensions/taskplane/types.ts` — `SegmentId`, `buildSegmentId()`, `TaskSegmentNode`
- `extensions/taskplane/mailbox.ts` — existing mailbox file layout

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/agent-bridge-extension.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/segment-expansion-tool.test.ts` (new)

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read the spec sections 0, 1, 2 thoroughly
- [ ] Read agent-bridge-extension.ts — understand tool registration pattern
- [ ] Read types.ts — understand SegmentId, buildSegmentId, TaskSegmentNode
- [ ] Read mailbox.ts — understand outbox directory layout

### Step 1: Extend SegmentId grammar in types.ts
- [ ] Extend `buildSegmentId()` to accept optional `sequence?: number` parameter
- [ ] Sequence suffix `::N` appended only when sequence >= 2
- [ ] Add `parseSegmentIdRepo()` helper that extracts repoId from structured node (NOT by string-splitting the ID)
- [ ] Add doc comment: "SegmentId is opaque — never parse by string-splitting"
- [ ] Define `SegmentExpansionRequest` interface matching spec schema
- [ ] Define request ID format helper: `buildExpansionRequestId()` → `exp-{timestamp}-{random5}`
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)

### Step 2: Implement request_segment_expansion tool
- [ ] Register `request_segment_expansion` tool in agent-bridge-extension.ts
- [ ] Tool only registered when agent has segment context (workspace mode) AND supervisor autonomy is "autonomous"
- [ ] Non-autonomous mode: tool registered but returns `accepted: false` with message "Segment expansion requires autonomous supervisor mode"
- [ ] Input schema per spec: `requestedRepoIds`, `rationale`, `placement?` (after-current | end), `edges?`
- [ ] Tool-level validation:
  - `requestedRepoIds` non-empty
  - Each repo ID matches `^[a-z0-9][a-z0-9._-]*$`
  - No duplicate repo IDs within the same request
- [ ] On valid input: write request file to mailbox outbox, return `accepted: true` with requestId
- [ ] On invalid input: return `accepted: false` with rejection details, NO file written
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/agent-bridge-extension.ts` (modified)

### Step 3: Request file writing
- [ ] Write request file to `.pi/mailbox/{batchId}/{agentId}/outbox/segment-expansion-{requestId}.json`
- [ ] File schema matches `SegmentExpansionRequest` interface from Step 1
- [ ] Populate: requestId, taskId, fromSegmentId, requestedRepoIds, rationale, placement, edges, timestamp
- [ ] Atomic write (temp file + rename) for crash safety
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/agent-bridge-extension.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed. Full suite quality gate.

- [ ] Create `extensions/tests/segment-expansion-tool.test.ts`
- [ ] Test: valid request → file written to correct path with correct schema
- [ ] Test: invalid repo ID format → rejected, no file written
- [ ] Test: duplicate repo IDs in request → rejected
- [ ] Test: empty requestedRepoIds → rejected
- [ ] Test: request ID format is `exp-{timestamp}-{random5}`
- [ ] Test: buildSegmentId with sequence=2 produces `task::repo::2`
- [ ] Test: buildSegmentId without sequence produces `task::repo` (backward compat)
- [ ] Test: non-autonomous mode → accepted: false with message
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 5: Documentation & Delivery
- [ ] Add JSDoc to new types and tool
- [ ] Update STATUS.md

## Documentation Requirements

**Must Update:**
- JSDoc on new interfaces and functions in types.ts

**Check If Affected:**
- `docs/specifications/taskplane/dynamic-segment-expansion.md` — update if implementation diverges

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] `request_segment_expansion` tool registered and functional
- [ ] Request files written to correct mailbox path with correct schema
- [ ] SegmentId grammar extended with sequence suffix
- [ ] Non-autonomous guard returns rejection

## Git Commit Convention

- `feat(TP-142): complete Step N — description`
- `fix(TP-142): description`
- `test(TP-142): description`

## Do NOT

- Consume or process expansion request files (that's TP-143 — engine side)
- Modify engine.ts, execution.ts, or lane-runner.ts
- Change existing segment planning or frontier logic
- Make the tool available in repo mode (workspace mode only)
- Auto-approve in non-autonomous modes

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
