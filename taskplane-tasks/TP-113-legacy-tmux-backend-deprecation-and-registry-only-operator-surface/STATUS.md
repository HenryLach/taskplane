# TP-113: Legacy TMUX Backend Deprecation and Registry-Only Operator Surface — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-31
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight inventory and boundary map
**Status:** ⬜ Not Started

- [ ] Inventory remaining TMUX references by category
- [ ] Define keep/remove deprecation boundary
- [ ] Record rationale in STATUS.md

---

### Step 1: Config and preflight deprecation posture
**Status:** ⬜ Not Started

- [ ] Deprecation messaging for `spawn_mode: tmux`
- [ ] V2-first doctor/preflight messaging
- [ ] Explicit warnings for legacy mode use

---

### Step 2: Operator surface migration
**Status:** ⬜ Not Started

- [ ] Registry-first operator surfaces
- [ ] Restrict TMUX fallback to explicit legacy contexts
- [ ] Update TMUX-centric user-facing wording

---

### Step 3: Abort/recovery and safety shims
**Status:** ⬜ Not Started

- [ ] Keep minimal legacy TMUX cleanup shims
- [ ] Registry-owned V2 abort/recovery path remains deterministic
- [ ] Remove duplicate/divergent control flows

---

### Step 4: Naming and schema cleanup prep
**Status:** ⬜ Not Started

- [ ] Introduce neutral naming bridge where feasible
- [ ] Preserve backward-compatible state behavior
- [ ] Add migration notes for future full TMUX removal

---

### Step 5: Tests and verification
**Status:** ⬜ Not Started

- [ ] Add behavioral tests for registry-first operator path
- [ ] Add tests for explicit legacy fallback gating
- [ ] Run targeted tests
- [ ] Run full suite
- [ ] Fix all failures

---

### Step 6: Documentation and release notes
**Status:** ⬜ Not Started

- [ ] Update Runtime V2 rollout/process docs
- [ ] Update operator command docs
- [ ] Add migration guidance for legacy TMUX users

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
| 2026-03-31 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
