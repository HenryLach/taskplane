## Plan Review: Step 1: Engine Event Infrastructure

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes from `PROMPT.md`: defining engine event types, introducing a callback subscription interface, emitting events on state transitions, and writing events to `.pi/supervisor/events.jsonl`. This is sufficient to unblock Step 2’s non-blocking execution refactor while keeping the event stream as the primary coordination mechanism.

### Issues Found
1. None.

### Missing Items
- None.

### Suggestions
- When defining the new engine event contract in `extensions/taskplane/types.ts`, include a shared base payload (`timestamp`, `batchId`, `waveIndex`) so event consumers can process all event kinds uniformly.
- Reuse/extend the existing Tier 0 event-writing path in `extensions/taskplane/persistence.ts` (`Tier0EventType`, `emitTier0Event`) instead of introducing a parallel writer, to avoid diverging JSONL schemas in `.pi/supervisor/events.jsonl`.
