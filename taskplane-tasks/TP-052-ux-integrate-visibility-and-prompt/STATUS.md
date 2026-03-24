# TP-052: UX: Integrate Visibility, Branch Protection, and Post-Batch Prompt — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read batch completion flow in extension.ts
- [ ] Read transitionToRoutingMode() in supervisor.ts
- [ ] Read /orch-integrate command handler
- [ ] Read ORCH_MESSAGES in messages.ts
- [ ] Check gh api availability for branch protection

---

### Step 1: Make /orch-integrate obvious after batch completion
**Status:** ⬜ Not Started

- [ ] Add prominent integrate guidance message after batch completion
- [ ] Include in supervisor batch summary and engine completion output
- [ ] Show exact commands (/orch-integrate and --pr variant)
- [ ] Message appears even without active supervisor

---

### Step 2: Detect branch protection and guide to --pr
**Status:** ⬜ Not Started

- [ ] Pre-merge branch protection check via gh api
- [ ] Graceful degradation when gh unavailable
- [ ] Clear error message on protection-related merge failure
- [ ] Suggest --pr in both pre-check warning and failure message

---

### Step 3: Fix post-batch input prompt visibility
**Status:** ⬜ Not Started

- [ ] Supervisor sends visible conversational message on routing transition
- [ ] Ensure pi input prompt is visible after batch output
- [ ] Clear signal that supervisor is ready for input

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All existing tests pass
- [ ] Tests for integrate message after batch
- [ ] Tests for branch protection detection
- [ ] Tests for protection warning in integrate command

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

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

*Reserved for execution notes*
