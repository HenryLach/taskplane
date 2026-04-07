# TP-154: Update how-to config guides for current architecture — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-07
**Review Level:** 0
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read both how-to files and catalog all stale references
- [ ] Read `.pi/taskplane-config.json` for the actual JSON config structure
- [ ] Read `docs/reference/configuration/taskplane-settings.md` for current field names

---

### Step 1: Update docs/how-to/configure-task-runner.md
**Status:** ⬜ Not Started

- [ ] Update title to reflect JSON config
- [ ] Update "Where this file lives" section for `taskplane-config.json`
- [ ] Convert all config examples from YAML to JSON with camelCase keys
- [ ] Remove all `/task` references
- [ ] Remove `spawn_mode` from worker section if present
- [ ] Update "Related guides" links

---

### Step 2: Update docs/how-to/configure-task-orchestrator.md
**Status:** ⬜ Not Started

- [ ] Update title for JSON config
- [ ] Update "Where this file lives" section for `taskplane-config.json`
- [ ] Convert all config examples from YAML to JSON with camelCase keys
- [ ] Remove tmux references (`spawn_mode: "tmux"`, `tmux_prefix`)
- [ ] Update "Related guides" links

---

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Verify all internal doc links resolve correctly
- [ ] Discoveries logged

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
| 2026-04-07 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
