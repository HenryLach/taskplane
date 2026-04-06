# TP-141: First-Install Bootstrap and Cross-Provider Guidance — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-06
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** 🟨 In Progress
- [x] Read PROMPT.md and STATUS.md
- [x] Verify TP-140 complete
- [x] Read init flow and model discovery
- [x] Read thinking picker
- [x] Check pi --list-models format

### Step 1: First-install detection and global prefs bootstrap
**Status:** ⬜ Not Started
- [x] Detect missing prefs file → bootstrap from schema defaults
- [x] Default thinking to "high" for all agents
- [x] Return bootstrap flag for downstream guidance
- [x] Atomic write (temp + rename)
- [x] Handle empty/corrupt prefs
- [x] Run targeted tests

### Step 2: Cross-provider model guidance in first init
**Status:** ⬜ Not Started
- [x] Detect first-init condition
- [x] Query models, count providers
- [x] 2+ providers: show guidance + cross-provider picker
- [x] 1 provider: skip with info message
- [x] Save to global prefs
- [x] Skip on subsequent inits
- [x] Run targeted tests

### Step 3: Thinking level picker enhancement
**Status:** ⬜ Not Started
- [ ] Settings TUI: all pi levels (off→xhigh) + inherit
- [ ] CLI init: same levels
- [ ] Default selection: high
- [ ] Thinking column from pi --list-models
- [ ] Run targeted tests

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full test suite passing
- [ ] Bootstrap creates prefs with thinking: high
- [ ] No re-bootstrap on existing prefs
- [ ] Cross-provider guidance triggers correctly
- [ ] Thinking picker shows all levels
- [ ] Single-provider skips guidance
- [ ] CLI smoke tests
- [ ] All failures fixed

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update config docs
- [ ] Update README if needed
- [ ] Document bootstrap behavior
- [ ] Update STATUS.md

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
| 2026-04-05 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-06 00:39 | Task started | Runtime V2 lane-runner execution |
| 2026-04-06 00:39 | Step 0 started | Preflight |

---

## Blockers

- **TP-140** must complete first (global preferences architecture)

---

## Notes

*Reserved for execution notes*
| 2026-04-06 00:42 | Review R001 | plan Step 1: APPROVE |
| 2026-04-06 00:47 | Review R002 | code Step 1: APPROVE |
| 2026-04-06 00:49 | Review R003 | plan Step 2: APPROVE |
