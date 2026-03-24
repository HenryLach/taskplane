# TP-052: UX: Integrate Visibility, Branch Protection, and Post-Batch Prompt — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read batch completion flow in extension.ts
- [x] Read transitionToRoutingMode() in supervisor.ts
- [x] Read /orch-integrate command handler
- [x] Read ORCH_MESSAGES in messages.ts
- [x] Check gh api availability for branch protection

---

### Step 1: Make /orch-integrate obvious after batch completion
**Status:** 🟨 In Progress

- [ ] Add prominent integrate guidance message after batch completion
- [ ] Include in supervisor batch summary and engine completion output
- [ ] Show exact commands (/orch-integrate and --pr variant)
- [ ] Message appears even without active supervisor

---

### Step 2: Detect branch protection and guide to --pr
**Status:** 🟨 In Progress

- [ ] Pre-merge branch protection check via gh api
- [ ] Graceful degradation when gh unavailable
- [ ] Clear error message on protection-related merge failure
- [ ] Suggest --pr in both pre-check warning and failure message

---

### Step 3: Fix post-batch input prompt visibility
**Status:** 🟨 In Progress

- [ ] Supervisor sends visible conversational message on routing transition
- [ ] Ensure pi input prompt is visible after batch output
- [ ] Clear signal that supervisor is ready for input

---

### Step 4: Testing & Verification
**Status:** 🟨 In Progress

- [ ] All existing tests pass
- [ ] Tests for integrate message after batch
- [ ] Tests for branch protection detection
- [ ] Tests for protection warning in integrate command

---

### Step 5: Documentation & Delivery
**Status:** 🟨 In Progress

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
| 2026-03-24 13:13 | Task started | Extension-driven execution |
| 2026-03-24 13:13 | Step 0 started | Preflight |
| 2026-03-24 13:13 | Step 1 started | Make /orch-integrate obvious after batch completion |
| 2026-03-24 13:13 | Step 2 started | Detect branch protection and guide to --pr |
| 2026-03-24 13:13 | Step 3 started | Fix post-batch input prompt visibility |
| 2026-03-24 13:13 | Step 4 started | Testing & Verification |
| 2026-03-24 13:13 | Step 5 started | Documentation & Delivery |
| 2026-03-24 13:13 | Task started | Extension-driven execution |
| 2026-03-24 13:13 | Step 0 started | Preflight |
| 2026-03-24 13:13 | Step 1 started | Make /orch-integrate obvious after batch completion |
| 2026-03-24 13:13 | Step 2 started | Detect branch protection and guide to --pr |
| 2026-03-24 13:13 | Step 3 started | Fix post-batch input prompt visibility |
| 2026-03-24 13:13 | Step 4 started | Testing & Verification |
| 2026-03-24 13:13 | Step 5 started | Documentation & Delivery |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
