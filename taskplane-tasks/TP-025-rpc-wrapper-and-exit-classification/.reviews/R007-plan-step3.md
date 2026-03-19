## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 plan in `taskplane-tasks/TP-025-rpc-wrapper-and-exit-classification/STATUS.md` captures the right test buckets, but it still does not state several required verification outcomes explicitly enough for this failure-prone lifecycle work. As written, the checklist could be marked complete while missing precedence and termination edge cases that are central to TP-025 correctness and recoverability.

### Issues Found
1. **[Severity: important]** — `STATUS.md:63` is too broad (“Unit tests for classifyExit()”) and does not explicitly commit to the required 9-path coverage from `PROMPT.md:104`, including precedence tie-cases from `extensions/taskplane/diagnostics.ts:230-310`.  
   **Suggested fix:** Make the expected outcome explicit: all 9 classifications + precedence collisions (e.g., `.DONE` vs failed retry, `timerKilled` vs non-zero exit, `stallDetected` vs `userKilled`).
2. **[Severity: important]** — `STATUS.md:65-67` does not explicitly require lifecycle/finalization verification for the single-write summary guard and competing termination handlers implemented in `bin/rpc-wrapper.mjs:546-621` and signal forwarding in `bin/rpc-wrapper.mjs:623-663`.  
   **Suggested fix:** Add a plan outcome proving exit summary is written exactly once across close/error/signal paths, including crash/no-`agent_end` behavior (`PROMPT.md:95`, `PROMPT.md:107`).
3. **[Severity: important]** — `STATUS.md:64` mentions redaction tests but does not explicitly require assertions for both persisted artifacts, despite hard requirement in `PROMPT.md:150` and separate summary redaction path in `bin/rpc-wrapper.mjs:215-243` and `bin/rpc-wrapper.mjs:590-593`.  
   **Suggested fix:** State explicit coverage for sidecar JSONL **and** exit summary JSON (`error`, `lastToolCall`, retry error strings), including secret masking and truncation behavior.

### Missing Items
- Explicit protocol-edge test intent for JSONL framing semantics already identified in preflight (`STATUS.md:172`) and implemented in `bin/rpc-wrapper.mjs:289-315` (chunked lines, optional `\r`, trailing buffered line on stream end).
- Spawn-failure path verification (`bin/rpc-wrapper.mjs:618-621`) to ensure summary writing remains deterministic when `pi` cannot start.
- Deterministic integration strategy for mock `pi` process behavior (fixture/script-driven stdout events), so verification does not depend on live CLI behavior.

### Suggestions
- Use a table-driven test matrix for `classifyExit()` to keep precedence rules auditable and easy to extend.
- Keep one focused process-level integration test for event ordering/lifecycle, then assert exact sidecar + summary artifacts.
