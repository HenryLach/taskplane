# TP-161: Extract task-runner utilities into taskplane library — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-11
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight — full reference inventory (BLOCKING)
**Status:** ⬜ Not Started

- [ ] Grep: `grep -rn "from.*task-runner" extensions/tests/`
- [ ] Grep: `grep -rn "task-runner\.ts" extensions/tests/` (source-reading tests)
- [ ] Grep: `grep -rn "task-runner" extensions/taskplane/ extensions/task-orchestrator.ts`
- [ ] Verify `isLowRiskStep` in `task-executor-core.ts`
- [ ] Verify `getSidecarDir` NOT in `execution.ts` / `lane-runner.ts`
- [ ] Run test baseline: `cd extensions && npm run test:fast`
- [ ] Document ALL findings in Discoveries table

---

### Step 1: Create extensions/taskplane/sidecar-telemetry.ts
**Status:** ⬜ Not Started

> ⚠️ Hydrate: expand after Step 0 confirms exact exports needed

- [ ] Extract `SidecarTailState`, `SidecarTelemetryDelta` interfaces verbatim
- [ ] Extract `getSidecarDir`, `createSidecarTailState`, `tailSidecarJsonl` verbatim
- [ ] All exports clean (no `_` prefix)
- [ ] File compiles

---

### Step 2: Create extensions/taskplane/context-window.ts
**Status:** ⬜ Not Started

- [ ] Export `FALLBACK_CONTEXT_WINDOW = 200_000`
- [ ] Export `resolveContextWindow(configuredWindow: number | undefined, ctx: ExtensionContext | null)`
- [ ] Same behavior as original, adapted signature
- [ ] No task-runner type imports

---

### Step 3: Export loadAgentDef from execution.ts
**Status:** ⬜ Not Started

- [ ] Read `loadAgentDef` in `task-runner.ts` — understand signature and behavior
- [ ] Export equivalent from `execution.ts` near `loadBaseAgentPrompt`
- [ ] Signature: `(cwd: string, name: string) => { systemPrompt: string; tools: string; model: string } | null`

---

### Step 4: Update all test imports
**Status:** ⬜ Not Started

> ⚠️ Hydrate: expand after Step 0 inventory is complete

- [ ] `context-pressure-cache.test.ts` → `sidecar-telemetry`
- [ ] `context-window-autodetect.test.ts` → `context-window`
- [ ] `context-window-resolution.test.ts` → `context-window`
- [ ] `sidecar-tailing.test.ts` → `sidecar-telemetry`
- [ ] `project-config-loader.test.ts` → `execution` / `config-loader`
- [ ] `task-runner-review-skip.test.ts` → `task-executor-core`
- [ ] Additional files from Step 0 inventory

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Full test suite passing
- [ ] Same pass rate as Step 0 baseline
- [ ] Fix all failures

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] JSDoc headers on both new files
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
