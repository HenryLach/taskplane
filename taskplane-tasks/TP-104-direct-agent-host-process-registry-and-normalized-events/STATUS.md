# TP-104: Direct Agent Host, Process Registry, and Normalized Events — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-30
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Trace the current rpc-wrapper responsibilities and identify which belong in a Runtime V2 host versus higher-level runtime code
- [ ] Define the manifest, registry, and normalized event flow before cutting code

---

### Step 1: Implement Process Registry and Manifests
**Status:** ⬜ Not Started

- [ ] Create the runtime registry and per-agent manifest helpers
- [ ] Persist enough metadata to replace TMUX-based liveness and cleanup checks
- [ ] Define deterministic state transitions for running, wrapping up, exited, crashed, timed out, and killed agents

---

### Step 2: Implement Direct Agent Host
**Status:** ⬜ Not Started

- [ ] Implement or evolve the host so it spawns `pi --mode rpc` directly with `shell: false` and no TMUX dependency
- [ ] Normalize RPC events into durable per-agent event logs and parent-facing updates
- [ ] Preserve mailbox inbox delivery and exit summaries on the new host

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add or update behavioral tests for direct-child hosting, registry lifecycle, normalized event persistence, and mailbox delivery
- [ ] Run the full suite
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update Runtime V2 docs if host/registry naming differs from plan
- [ ] Log discoveries in STATUS.md

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
| 2026-03-30 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
