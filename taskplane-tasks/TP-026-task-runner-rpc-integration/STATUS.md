# TP-026: Task-Runner RPC Wrapper Integration — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read spawnAgentTmux() in task-runner.ts
- [ ] Read poll loop implementation
- [ ] Read TP-025 artifacts
- [ ] Verify RPC wrapper runs

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
