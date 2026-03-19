# TP-026: Task-Runner RPC Wrapper Integration — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read spawnAgentTmux() in task-runner.ts
- [x] Read poll loop implementation
- [x] Read TP-025 artifacts
- [x] Verify RPC wrapper runs

---

### Step 1: Update spawnAgentTmux to Use RPC Wrapper
**Status:** ⬜ Not Started

- [ ] Generate sidecar and exit summary file paths
- [ ] Build rpc-wrapper.mjs command line
- [ ] Resolve rpc-wrapper.mjs path from npm package
- [ ] Replace pi -p with rpc-wrapper in tmux send-keys
- [ ] Workspace-aware paths for telemetry files

---

### Step 2: Read Sidecar Telemetry During Polling
**Status:** ⬜ Not Started

- [ ] Tail new sidecar JSONL lines on each poll tick
- [ ] Track file read offset for incremental reads
- [ ] Accumulate token counts and cost from message_end events
- [ ] Detect active retries from auto_retry events
- [ ] Make telemetry available for dashboard
- [ ] Handle missing/empty sidecar gracefully

---

### Step 3: Produce Structured Exit Diagnostic
**Status:** ⬜ Not Started

- [ ] Read exit summary JSON after session exit
- [ ] Call classifyExit() and populate TaskExitDiagnostic
- [ ] Add exitDiagnostic additively to batch state task record
- [ ] Clean up or preserve telemetry files

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Test rpc-wrapper command generation
- [ ] Test sidecar tailing and accumulation
- [ ] Test exit summary reading and classification
- [ ] Test crash scenario (missing summary)
- [ ] Test workspace mode paths
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Inline comments updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-19 22:16 | Task started | Extension-driven execution |
| 2026-03-19 22:16 | Step 0 started | Preflight |
| 2026-03-19 22:16 | Task started | Extension-driven execution |
| 2026-03-19 22:16 | Step 0 started | Preflight |
| 2026-03-19 22:17 | Review R001 | plan Step 0: APPROVE |
| 2026-03-19 22:17 | Review R001 | plan Step 0: REVISE |
| 2026-03-19 22:18 | Worker iter 1 | done in 63s, ctx: 15%, tools: 14 |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
