# TP-057: Persistent Reviewer Context — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read design spec (Option D: Tool-Driven Reviewer)
- [ ] Read `review_step` tool handler and `spawnReviewerSession()` in task-runner.ts
- [ ] Read reviewer template and RPC wrapper spawn pattern

---

### Step 1: Create Reviewer Extension with `wait_for_review` Tool
**Status:** ⬜ Not Started

- [ ] Create `extensions/reviewer-extension.ts` with `wait_for_review` tool registration
- [ ] Implement signal file polling with configurable interval (2-5s) and timeout
- [ ] Handle shutdown signal for clean exit
- [ ] Add reviewer polling constants to types.ts

---

### Step 2: Update `review_step` Handler for Persistent Mode
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on actual review_step handler structure discovered in Step 0

- [ ] First call: spawn reviewer with reviewer-extension, write request + signal, poll for verdict
- [ ] Subsequent calls: reuse session, increment counter, write request + signal, poll for verdict
- [ ] Fallback: detect dead session, log warning, spawn fresh reviewer
- [ ] Cleanup: shutdown signal on task completion, kill session after grace period

---

### Step 3: Update Reviewer Template for Persistent Mode
**Status:** ⬜ Not Started

- [ ] Update reviewer template for wait_for_review loop workflow
- [ ] Ensure template works in both persistent and fallback (fresh spawn) modes
- [ ] Instruct reviewer to reference previous reviews when relevant

---

### Step 4: Path Resolution and Spawn Integration
**Status:** ⬜ Not Started

- [ ] Add reviewer-extension.ts to spawn command's --extensions list
- [ ] Add to package.json files array
- [ ] Verify path resolution works for global npm installs

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create persistent-reviewer-context.test.ts with signal, session reuse, fallback, and cleanup tests
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update review-loop.md with persistent reviewer section
- [ ] Update supervisor-primer.md
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
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
| 2026-03-24 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Design spec: `.pi/local/docs/taskplane/persistent-reviewer-context-spec.md`*
*Key design decisions from spec review: separate extension file (not inline), 2-5s poll interval, reviewer loads its own context via tools (not pre-loaded), same reviewer handles all review types including test reviews.*
