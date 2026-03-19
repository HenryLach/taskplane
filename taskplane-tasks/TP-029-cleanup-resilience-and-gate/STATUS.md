# TP-029: Cleanup Resilience & Post-Merge Gate — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [ ] Read CONTEXT.md (Tier 2 context)
- [ ] Read worktree cleanup flow (engine → worktree.ts)
- [ ] Read merge worktree lifecycle (merge.ts)
- [ ] Understand issue #93 root cause: why only last-wave repos get cleanup
- [ ] Read roadmap Phase 2 sections 2b, 2c, 2d
- [ ] Read /orch-integrate flow in extension.ts (autostash, cleanup touchpoints)
- [ ] Inventory existing test surface for cleanup/worktree/integrate paths
- [ ] Record preflight findings: insertion points, expected failure-path behavior

---

### Step 1: Fix Per-Wave Cleanup Across All Repos
**Status:** ⬜ Not Started

- [ ] Iterate ALL repos per wave for cleanup
- [ ] Apply force cleanup fallback pattern
- [ ] Extend to merge worktrees
- [ ] Remove empty .worktrees/ dirs

---

### Step 2: Post-Merge Cleanup Gate
**Status:** ⬜ Not Started

- [ ] Verify cleanup success before advancing wave
- [ ] Pause batch on cleanup failure
- [ ] Emit diagnostic with recovery commands

---

### Step 3: Integrate Cleanup into /orch-integrate
**Status:** ⬜ Not Started

- [ ] Clean autostash entries after integrate
- [ ] Verify polyrepo acceptance criteria
- [ ] Report cleanup status

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Multi-repo cleanup tests
- [ ] Force cleanup fallback tests
- [ ] Cleanup gate tests
- [ ] Autostash cleanup tests
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Close issue #93
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
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
| 2026-03-19 20:27 | Task started | Extension-driven execution |
| 2026-03-19 20:27 | Step 0 started | Preflight |
| 2026-03-19 20:27 | Task started | Extension-driven execution |
| 2026-03-19 20:27 | Step 0 started | Preflight |
| 2026-03-19 20:29 | Review R001 | plan Step 0: REVISE |
| 2026-03-19 20:29 | Review R001 | plan Step 0: REVISE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
