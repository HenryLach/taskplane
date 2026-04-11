# TP-160: Pass reviewer model/thinking/tools config to spawnReviewer subprocess — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read `executeWave()` and `executeLaneV2()` in `execution.ts`
- [ ] Read `LaneRunnerConfig` and worker env setup in `lane-runner.ts`
- [ ] Read `spawnReviewer()` in `agent-bridge-extension.ts`
- [ ] Confirm `runnerConfig` in scope at `executeWave` call sites in `engine.ts`
- [ ] Verify test baseline

---

### Step 1: Thread reviewer config through the call chain
**Status:** ⬜ Not Started

> ⚠️ Hydrate: 5 sub-parts — expand based on Step 0 findings

- [ ] Part A: Add `reviewerConfig?` to `executeWave` signature, pass via extraEnvVars
- [ ] Part B: Add reviewer fields to `LaneRunnerConfig`, populate from extraEnvVars in `executeLaneV2`
- [ ] Part C: Set `TASKPLANE_REVIEWER_*` env vars in worker subprocess in `lane-runner.ts`
- [ ] Part D: Read env vars in `spawnReviewer`, pass `--model`/`--thinking`/`--tools` to pi CLI
- [ ] Part E: Update both `executeWave` call sites in `engine.ts` to pass reviewer config

---

### Step 2: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Full test suite passing
- [ ] CLI smoke passing
- [ ] Fix all failures

---

### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Comment in `spawnReviewer` explaining env var source
- [ ] Check docs/reference for affected content
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
| 2026-04-10 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*
