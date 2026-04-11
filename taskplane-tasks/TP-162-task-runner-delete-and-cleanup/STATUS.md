# TP-162: Delete task-runner.ts and clean up all references — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-11
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Confirm TP-161 complete (new modules exist, tests pass)
- [ ] Grep all remaining task-runner references across project
- [ ] Categorize each reference
- [ ] Run test baseline

---

### Step 1: Remove from package.json
**Status:** ⬜ Not Started

- [ ] Remove from `pi.extensions` array
- [ ] Remove from `files` array
- [ ] Validate JSON: `node -e "require('./package.json')"`

---

### Step 2: Remove dead code from execution.ts
**Status:** ⬜ Not Started

- [ ] Delete `resolveTaskRunnerExtensionPath()`
- [ ] Clean TASK_AUTOSTART legacy comments

---

### Step 3: Delete task-runner.ts
**Status:** ⬜ Not Started

- [ ] Final check: no remaining imports
- [ ] Final check: no source-reading references in tests
- [ ] **Delete `extensions/task-runner.ts`**

---

### Step 4: Update docs and templates
**Status:** ⬜ Not Started

> ⚠️ Hydrate: expand after Step 0 grep shows all remaining references

- [ ] `extensions/task-orchestrator.ts` — remove dual-load comment
- [ ] `docs/maintainers/development-setup.md`
- [ ] `docs/maintainers/package-layout.md`
- [ ] `docs/explanation/architecture.md`
- [ ] `AGENTS.md`
- [ ] `templates/agents/task-worker.md` — audit
- [ ] `bin/taskplane.mjs` — audit
- [ ] Any additional files from Step 0 grep

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Full test suite passing
- [ ] CLI smoke checks passing (`help`, `version`, `init --dry-run`, `doctor`)
- [ ] Fix all failures

---

### Step 6: Version bump and delivery
**Status:** ⬜ Not Started

- [ ] Bump `package.json` version to `0.26.0`
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
| 2026-04-11 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*
