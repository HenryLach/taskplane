# TP-104: Direct Agent Host, Process Registry, and Normalized Events — Status

**Current Step:** Complete
**Status:** ✅ Complete
**Last Updated:** 2026-03-30
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Trace the current rpc-wrapper responsibilities and identify which belong in a Runtime V2 host versus higher-level runtime code
- [x] Define the manifest, registry, and normalized event flow before cutting code

---

### Step 1: Implement Process Registry and Manifests
**Status:** ✅ Complete

- [x] Create the runtime registry and per-agent manifest helpers
- [x] Persist enough metadata to replace TMUX-based liveness and cleanup checks
- [x] Define deterministic state transitions for running, wrapping up, exited, crashed, timed out, and killed agents

---

### Step 2: Implement Direct Agent Host
**Status:** ✅ Complete

- [x] Implement or evolve the host so it spawns `pi --mode rpc` directly with `shell: false` and no TMUX dependency
- [x] Normalize RPC events into durable per-agent event logs and parent-facing updates
- [x] Preserve mailbox inbox delivery and exit summaries on the new host

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Add or update behavioral tests for direct-child hosting, registry lifecycle, normalized event persistence, and mailbox delivery
- [x] Run the full suite (3215 pass, 0 fail)
- [x] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] Update Runtime V2 docs if host/registry naming differs from plan
- [x] Log discoveries in STATUS.md

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| rpc-wrapper.mjs pure functions (applyEvent, buildExitSummary, checkMailboxAndSteer) are reusable — agent-host reimplements the pattern directly rather than importing the .mjs file | Clean separation; rpc-wrapper stays for legacy TMUX path during migration | extensions/taskplane/agent-host.ts |
| Pi CLI on Windows must be spawned via node cli.js, not pi.CMD | resolvePiCliPath() handles this for both platforms | extensions/taskplane/agent-host.ts |
| stdin close delay of >=100ms after agent_end prevents Windows assertion failures | closeDelayMs parameter with 100ms default | extensions/taskplane/agent-host.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-30 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-30 | Registry complete | process-registry.ts with manifest CRUD, snapshot, liveness, orphan detection, cleanup, event/snapshot persistence |
| 2026-03-30 | Agent host complete | agent-host.ts with direct spawn, RPC event normalization, mailbox delivery, exit summaries |
| 2026-03-30 | Tests complete | 29 tests in process-registry.test.ts. Full suite: 3215 pass, 0 fail |
| 2026-03-30 | Task complete | .DONE created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
