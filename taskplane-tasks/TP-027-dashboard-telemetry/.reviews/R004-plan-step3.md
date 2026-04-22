## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 plan captures baseline checks, but it is too generic for the telemetry behaviors added in Steps 1–2. Right now it mostly verifies “no crash” and global suite health, without validating the new server/frontend merge logic and event-driven state transitions. Tightening the scenario-level verification outcomes is needed to make this step a reliable gate.

### Issues Found
1. **[Severity: important]** — The testing plan is underspecified for the new telemetry-specific behaviors. `STATUS.md:49-52` lists broad checks only, but the implemented logic includes retry state transitions, compaction counting, telemetry/lane-state merge behavior, and fallback rendering paths (`dashboard/server.cjs:432-444,465-482,492-514`; `dashboard/public/app.js:81-93,373-377,516-547`). Add an explicit scenario matrix with expected outcomes for these cases.
2. **[Severity: important]** — The plan does not include a direct API contract verification for newly added response fields. `buildDashboardState()` now returns additive `telemetry` and `batchTotalCost` fields (`dashboard/server.cjs:511-515`), but Step 3 only checks `node --check dashboard/server.cjs` (`STATUS.md:52`), which is syntax-only. Add a runtime check that `/api/status` includes the new fields and correct values under mock telemetry input.
3. **[Severity: important]** — “Run full test suite” (`STATUS.md:51`) is insufficient confidence for this change area because there are no dashboard-focused automated tests in `extensions/tests` or `dashboard/`. Add targeted verification intent (scripted/manual) for dashboard server + frontend behavior so this step doesn’t rely on unrelated suite pass results.

### Missing Items
- Explicit verification for retry badge lifecycle (`auto_retry_start` -> active, `auto_retry_end` -> inactive) and compaction badge visibility (`>0` only).
- Explicit verification for cost precedence/deduping: lane-state primary, telemetry supplementary, and summary fallback when `batchTotalCost` is absent.
- Explicit fallback checks for pre-RPC sessions and missing/malformed telemetry input (no `.pi/telemetry`, malformed JSONL line, file truncation/deletion).

### Suggestions
- Add a small reproducible mock-data script that writes `.pi/telemetry/*.jsonl`, then validate `/api/status` payload and UI rendering against expected values.
- Include `node --check dashboard/public/app.js` as a quick additional syntax guard for frontend changes.
