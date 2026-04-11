# TP-162: Delete task-runner.ts and clean up all references — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-11
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Confirm TP-161 complete (new modules exist, tests pass)
- [x] Grep all remaining task-runner references across project
- [x] Categorize each reference
- [x] Run test baseline (3255/3255 pass)

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
| TP-161 did NOT update all test imports — 3 test files still import `loadConfig`/`_resetPointerWarning` from task-runner.ts | Fix in Step 3: export these from config-loader.ts and update test imports | extensions/tests/ |
| 3 test files are source-extraction tests reading task-runner.ts directly (crash-recovery, persistent-reviewer, persistent-worker) | Delete these test files in Step 3 — their contracts covered by lane-runner-v2.test.ts | extensions/tests/ |
| mailbox.test.ts has TP-090 source-extraction block that reads task-runner.ts | Remove only the TP-090 describe block in Step 3 | extensions/tests/mailbox.test.ts |
| config-loader.ts doesn't currently import workspace.ts — adding loadConfig will require that import | No circular dep risk (workspace.ts imports only git.ts and types.ts) | extensions/taskplane/config-loader.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-11 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 06:11 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 06:11 | Step 0 started | Preflight |

---

## Blockers

*None*
