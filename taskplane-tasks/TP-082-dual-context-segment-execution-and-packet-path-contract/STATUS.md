# TP-082: Packet-Path Env Contract and Task-Runner Authority — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-28
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Trace current worker launch env and task-runner path resolution flow
- [ ] Identify all places in task-runner that derive packet paths from `cwd`
- [ ] Define explicit env var contract and fallback policy before implementation

---

### Step 1: Add packet-path environment contract
**Status:** ⬜ Not Started

- [ ] Add support for `TASK_PACKET_PROMPT_PATH`
- [ ] Add support for `TASK_PACKET_STATUS_PATH`
- [ ] Add support for `TASK_PACKET_DONE_PATH`
- [ ] Add support for `TASK_PACKET_REVIEWS_DIR`
- [ ] Thread vars into task-runner invocation environment (where execution layer already has packet path info)

---

### Step 2: Enforce authoritative packet file resolution in task-runner
**Status:** ⬜ Not Started

- [ ] Update task-runner to prefer packet env paths over cwd-derived paths
- [ ] Ensure `.DONE` checks/write/read use packet-path authority when provided
- [ ] Preserve backward compatibility when env vars are absent (mono-repo / legacy)

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust tests for packet-path env precedence
- [ ] Add/adjust tests for authoritative `.DONE` path behavior
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update docs for packet-path env contract if names/fallback changed
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

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
| 2026-03-28 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
