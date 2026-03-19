## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 plan in `taskplane-tasks/TP-025-rpc-wrapper-and-exit-classification/STATUS.md` has the right high-level buckets, but it is still too broad for the risk profile of this wrapper/lifecycle work. The current checklist does not yet make several required outcomes explicit (classification precedence, one-write finalization under competing handlers, protocol edge cases), so it can pass “green” while still missing regressions that matter for recoverability and telemetry correctness.

### Issues Found
1. **[Severity: important]** — `STATUS.md:61` says “Unit tests for classifyExit()” but does not explicitly include the required 9-path coverage from `PROMPT.md:104`, nor precedence tie-cases defined in `extensions/taskplane/diagnostics.ts:230-310`.  
   **Suggested fix:** State the expected test outcome as “all 9 classifications + precedence collisions validated” (e.g., `.DONE` vs retry-failure, timerKilled vs non-zero exit, stallDetected vs userKilled).
2. **[Severity: important]** — `STATUS.md:63-64` does not explicitly cover termination-path determinism for the single-write guard and signal flow introduced in Step 2 (`bin/rpc-wrapper.mjs:546-621` and `bin/rpc-wrapper.mjs:623-663`).  
   **Suggested fix:** Add explicit lifecycle outcomes proving exit summary is written exactly once across overlapping `close`/`error`/signal paths, including crash/no-`agent_end` behavior (`PROMPT.md:95`, `PROMPT.md:107`).
3. **[Severity: important]** — Redaction verification is underspecified relative to the hard requirement not to persist secrets in sidecar **or summary** (`PROMPT.md:150`). Current plan text (`STATUS.md:62`) does not make summary redaction assertions explicit, despite summary redaction logic being separate (`bin/rpc-wrapper.mjs:215-242`, `bin/rpc-wrapper.mjs:590-593`).  
   **Suggested fix:** Call out required assertions for both artifacts: sidecar JSONL and exit summary JSON, including `*_KEY/*_TOKEN/*_SECRET` handling and truncation boundaries.

### Missing Items
- Explicit protocol-edge coverage for JSONL framing semantics already identified in preflight (`STATUS.md:165`) and implemented in `bin/rpc-wrapper.mjs:281-315` (split on `\n`, optional trailing `\r`, flush trailing buffer).
- A deterministic integration strategy for mocking `pi` process behavior (scripted fake process / fixture-driven stdout+stderr) so Step 3 verification is reproducible and not CLI-environment dependent.
- Explicit spawn-failure/error-path verification (`bin/rpc-wrapper.mjs:618-621`) to ensure summary writing remains robust when `pi` cannot start.

### Suggestions
- Use a table-driven suite for `classifyExit()` inputs/expected outputs so precedence remains auditable.
- Keep one process-level integration fixture focused on lifecycle ordering (event stream + signal/error ordering), then assert exact sidecar/summary artifacts.
