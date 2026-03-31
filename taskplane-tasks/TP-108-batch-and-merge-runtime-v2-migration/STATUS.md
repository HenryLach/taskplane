# TP-108: Batch and Merge Runtime V2 Migration — Status

**Current Step:** Step 1 — Backend Selection Expansion
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-30
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Trace current wave execution, lane provisioning, merge hosting, and cleanup/recovery logic from the perspective of TMUX dependency
- [ ] Define exactly which runtime responsibilities shift to engine, lane-runner, and agent-host in the batch path

---

### Step 1: Lane-Runner Batch Integration
**Status:** ⬜ Not Started

- [ ] Update engine/execution flow to launch lane-runners for batch waves
- [ ] Replace lane-session/TMUX liveness assumptions with registry-backed lifecycle handling
- [ ] Preserve worktree and orch-branch semantics during the cutover

---

### Step 2: Merge Host Migration
**Status:** ⬜ Not Started

- [ ] Move merge agent execution onto the direct agent host/backend
- [ ] Preserve structured merge telemetry, verification behavior, and failure classification on the new path
- [ ] Ensure merge recovery and pause behavior still works without TMUX

---

### Step 3: Recovery, Cleanup, and Tooling
**Status:** ⬜ Not Started

- [ ] Replace TMUX-centric active-session discovery and orphan cleanup with registry/process-based behavior
- [ ] Keep pause/resume/abort semantics recoverable under the new ownership model
- [ ] Review operator tooling affected by the backend cutover

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add or update behavioral tests for full-wave Runtime V2 execution and merge lifecycle
- [ ] Run the full suite
- [ ] Run CLI smoke checks
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update rollout docs, architecture docs, and any operator guidance changed by the batch cutover
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
