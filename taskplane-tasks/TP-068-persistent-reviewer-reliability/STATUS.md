# TP-068: Fix Persistent Reviewer Reliability — Status

**Current Step:** Step 3: Add Graceful Skip on Double Failure
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-25
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read persistent mode instructions in reviewer template
- [x] Read spawnPersistentReviewer() in task-runner.ts
- [x] Read wait_for_review tool registration in reviewer-extension.ts

---

### Step 1: Fix Reviewer Template Prompting
**Status:** ✅ Complete
- [x] Update template: explicitly state wait_for_review is a registered tool, not bash
- [x] Update inline spawn prompt in task-runner.ts
- [x] Update local template comments

---

### Step 2: Add Early-Exit Detection
**Status:** ✅ Complete
- [x] Detect reviewer exit within 30s as tool compatibility failure
- [x] Trigger fallback immediately instead of waiting for verdict timeout

---

### Step 3: Add Graceful Skip on Double Failure
**Status:** ⬜ Not Started
- [x] Improve logging for skipped reviews
- [ ] Make extractVerdict tolerate non-standard formats ("Changes requested" → REVISE)
- [ ] Ensure shutdown signal written on all paths

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Update persistent-reviewer-context tests
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
|---|------|------|---------|------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-25 21:10 | Task started | Extension-driven execution |
| 2026-03-25 21:10 | Step 0 started | Preflight |
| 2026-03-25 21:10 | Task started | Extension-driven execution |
| 2026-03-25 21:10 | Step 0 started | Preflight |
| 2026-03-25 21:12 | Reviewer R001 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |
| 2026-03-25 21:13 | Review R001 | plan Step 1: APPROVE (fallback) |

---

## Blockers

*None*

---

## Notes

*Critical fix. Root cause: OpenAI gpt-5.3-codex calls wait_for_review via bash instead of as a registered tool. Cascading failure breaks all task batches using persistent reviewer with non-Anthropic reviewer models.*
