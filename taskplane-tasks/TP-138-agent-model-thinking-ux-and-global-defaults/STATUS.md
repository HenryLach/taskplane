# TP-138: Agent Model/Thinking UX and Global Defaults — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-04
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read taskplane init flow
- [ ] Read config-schema.ts defaults
- [ ] Read config-loader.ts preferences
- [ ] Read Sage model selection reference
- [ ] Understand pi model registry API

### Step 1: Fix defaults to inherit
**Status:** ⬜ Not Started
- [ ] Worker thinking "off" → "" (inherit)
- [ ] Reviewer model hardcode → "" (inherit)
- [ ] Support "inherit" string alias
- [ ] Update templates
- [ ] Verify runtime inheritance

### Step 2: Interactive model selection
**Status:** ⬜ Not Started
- [ ] Query pi model registry
- [ ] Show enabled models
- [ ] List selection UX
- [ ] Per-agent-type selection
- [ ] "Inherit" as default option
- [ ] Manual entry fallback

### Step 3: Auto-thinking
**Status:** ⬜ Not Started
- [ ] Query thinking capability
- [ ] Auto-set on selection
- [ ] Show after model pick
- [ ] Allow override
- [ ] Reset on model change
- [ ] Disable for non-thinking models

### Step 4: Global defaults
**Status:** ⬜ Not Started
- [ ] Extend preferences schema
- [ ] Pre-populate from defaults during init
- [ ] Add --save-as-defaults command
- [ ] Detect global vs local install
- [ ] Show save confirmation

### Step 5: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Test fresh init no defaults
- [ ] Test init with global defaults
- [ ] Test save-as-defaults
- [ ] Test "inherit" alias
- [ ] Test model selection
- [ ] Run full suite, fix failures

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update config docs
- [ ] Update README
- [ ] Update STATUS.md

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
