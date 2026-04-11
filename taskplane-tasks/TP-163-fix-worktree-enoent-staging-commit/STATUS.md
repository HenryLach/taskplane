# TP-163: Fix ENOENT when task folders are uncommitted at batch start (#471) — Status

**Current Step:** Step 1: Fast-forward orch branch after staging commit
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-11
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** S

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `ensureTaskFilesCommitted` — understand staging commit flow
- [x] Read `executeWave` — confirm sequencing (staging before worktree creation)
- [x] Read orch branch creation in `engine.ts` — confirm it runs before `executeWave`
- [x] Confirm `baseBranch` param in `executeWave` is the orch branch name
- [x] Verify test baseline

---

### Step 1: Fast-forward orch branch after staging commit
**Status:** 🟨 In Progress

- [ ] Add `orchBranch?: string` param to `ensureTaskFilesCommitted`
- [ ] After staging commit: get orchBranch tip SHA + HEAD SHA
- [ ] Check ancestry: if `merge-base --is-ancestor <orchTip> <newHead>` → FF case: `update-ref` with expected-old-sha
- [ ] Non-FF case (orchBranch advanced with wave merges): use `git merge-tree --write-tree <orchTip> <newHead>` to compute merged tree, then `commit-tree` to create merge commit, then `update-ref` with expected-old-sha
- [ ] Wrap entire ref-update in try/catch — non-fatal on failure (log warning)
- [ ] Pass `orchBranch` (= `baseBranch`) from `executeWave` to `ensureTaskFilesCommitted`
- [ ] Verify workspace mode correctness

---

### Step 2: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Full test suite passing
- [ ] CLI smoke passing
- [ ] Fix all failures

---

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Inline comment explaining the fix
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | 1 | REVISE | .reviews/R001-plan-step1.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-11 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 03:43 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 03:43 | Step 0 started | Preflight |

---

## Blockers

*None*
| 2026-04-11 03:48 | Review R001 | plan Step 1: REVISE |
