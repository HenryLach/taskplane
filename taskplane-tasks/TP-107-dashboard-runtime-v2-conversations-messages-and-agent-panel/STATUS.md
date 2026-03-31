# TP-107: Dashboard Runtime V2 Conversations, Messages, and Agent Panel — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-30
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Audit the dashboard's current dependence on lane-state files, worker-conversation logs, and TMUX pane capture
- [ ] Map each panel to its Runtime V2 source of truth: registry, lane snapshots, normalized agent events, and mailbox state

---

### Step 1: Runtime V2 Data Loading
**Status:** ⬜ Not Started

- [ ] Add Runtime V2 loaders for registry, per-agent events, and lane snapshots while retaining temporary compatibility shims only where necessary
- [ ] Define clear precedence when both legacy and Runtime V2 artifacts exist during migration

---

### Step 2: Conversations, Messages, and Agent Panel
**Status:** ⬜ Not Started

- [ ] Render conversation streams from normalized event logs instead of pane capture
- [ ] Add/update the mailbox messages panel on top of Runtime V2 mailbox + delivery events
- [ ] Add an agent/process panel driven by the runtime registry

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Run dashboard/server sanity checks
- [ ] Perform manual dashboard verification for conversations, messages, and agent health on a Runtime V2 run
- [ ] Run the full suite if shared extension/server contracts changed
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update README and architecture docs for the new dashboard model if behavior/user guidance changed
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
