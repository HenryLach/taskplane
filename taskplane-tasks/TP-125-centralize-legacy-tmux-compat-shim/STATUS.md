# TP-125: Centralize Legacy TMUX Compatibility Shim — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Inventory compatibility call sites
**Status:** ⬜ Not Started
- [ ] Identify every remaining runtime call site for TMUX-shaped legacy inputs
- [ ] Confirm each site is ingress compatibility only
- [ ] Log list in STATUS.md

### Step 1: Introduce compatibility shim module
**Status:** ⬜ Not Started
- [ ] Create `extensions/taskplane/tmux-compat.ts`
- [ ] Add config alias normalization helpers
- [ ] Add persisted lane alias normalization helpers
- [ ] Add spawnMode legacy classification/deprecation helper

### Step 2: Replace scattered compatibility logic
**Status:** ⬜ Not Started
- [ ] Update `config-loader.ts` to use shim helpers
- [ ] Update `persistence.ts` normalization to use shim helpers
- [ ] Update other ingress paths to use shim helpers
- [ ] Keep behavior identical

### Step 3: Tests
**Status:** ⬜ Not Started
- [ ] Add/adjust compatibility tests via shim
- [ ] Run full extension suite
- [ ] Fix failures

### Step 4: Delivery
**Status:** ⬜ Not Started
- [ ] Record TMUX-reference count delta
- [ ] Document exactly which legacy inputs remain supported

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
