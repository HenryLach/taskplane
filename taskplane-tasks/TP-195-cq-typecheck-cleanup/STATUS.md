# TP-195: Code-quality typecheck cleanup — Status

**Current Step:** Step 1: Plan the cleanup strategy
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Steps 3 and 4 expand at runtime with one item per affected file
> based on the live `npm run typecheck` inventory captured in Step 0.
>
> **⚠️ Order of Operations rule (live in worker prompt):** do NOT mark a step
> `Complete` until that step's code review has returned APPROVE. This task
> is Review Level 2 — per-step plan + code reviews fire automatically.
>
> **Review structure:** per-step reviews. Expected: ~5 plan + ~5 code = ~10
> reviews total.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main` (lane worktree, fresh from TP-191 merge) — verified with `git log --oneline -5` (HEAD = 19954aee, TP-193 merged via PR #572)
- [x] TP-191 confirmed merged (`npm run typecheck` script exists in `package.json`, `extensions/tsconfig.ci.json` exists)
- [x] TP-191 STATUS.md Discoveries read for the typecheck error inventory baseline
- [x] Live `npm run typecheck` error count captured: **264 errors** (vs sage's ~267 estimate; close enough)
- [x] Live category breakdown captured (see Discoveries → 'Live error inventory')
- [x] Baseline test count recorded: 3625 tests, **3624 passing / 1 skipped / 0 failed** (matches TP-191 baseline)
- [x] Decision recorded: **runtime source first** (~68 errors across 8 files), then tests (~196 errors). Source-first lets type signatures settle before fixing test mocks against them.

---

### Step 1: Plan the cleanup strategy per error category
**Status:** 🟨 In Progress

> ⚠️ Plan-review checkpoint.

- [x] Per-category fix approach documented in Discoveries
- [x] Real-bug-vs-drift categorization complete (see 'Per-category strategy' table below)
- [x] Anti-shortcut policy reaffirmed in Discoveries
- [x] Decision on shared mock-helper: **introduce `extensions/tests/helpers/mock-orchestrator-config.ts`** with `makeOrchestratorConfig(overrides?)` factory — both top-3 test files (workspace-config.integration, worktree-lifecycle.integration, plus orch-state-persistence and others) share the same `OrchestratorConfig` shape and accumulate the same `pre_warm/merge/failure/monitoring/verification` missing-fields churn (per error inventory). One factory dedupes ~50% of the TS2741/TS2739 mock-drift errors.

---

### Step 2: Apply mechanical auto-fixes (if any safe ones exist)
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] Definite IDE-suggestable fixes applied via search-and-replace
- [ ] No assertions / casts / defaults applied here (deferred to per-error judgment in Steps 3/4)
- [ ] Typecheck error count after this step recorded
- [ ] Targeted tests pass

---

### Step 3: Fix runtime-source errors (~69 errors)
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

> ⚠️ Hydrate: expand checkboxes with one item per affected source file.

- [ ] Each source-side error fixed via correct type changes
- [ ] After each module: targeted tests pass
- [ ] Full fast suite passes
- [ ] Typecheck error count drops by ~69

---

### Step 4: Fix test-side errors (~198 errors)
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

> ⚠️ Hydrate: expand checkboxes with one item per affected test file.

- [ ] Mock-object drift fixes with semantically correct values
- [ ] Shared helper introduced (if Step 1 decision was yes)
- [ ] After each test file: that file passes in isolation
- [ ] Full fast suite passes
- [ ] Typecheck error count drops to 0

---

### Step 5: Verify pi-shim adequacy
**Status:** ⬜ Not Started

- [ ] `npm run typecheck` exits 0
- [ ] Pi-shim extensions (if any) documented in Discoveries

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passes (3624+ passing / 1 skipped / 0 failed — match TP-191 baseline)
- [ ] FULL integration suite passes
- [ ] `npm run typecheck` exits 0 (the gate this task delivers)
- [ ] `npm run lint` exit code unchanged from TP-191 baseline
- [ ] `npm run format:check` exit code unchanged
- [ ] CLI smoke clean

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entry under [Unreleased] → Internal added
- [ ] Discoveries logged below (per-category breakdown, real bugs uncovered, pi-shim extensions)
- [ ] All commits include `TP-195` prefix; grouped by module/category

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Live error count: 264 (vs sage's ~267 estimate) | Authoritative target for this task | Step 0 |
| TS narrowing fails on `{ok:true}\|{ok:false;reason:string}` under `strict:false` | Add `reason?:undefined` to ok-true branch — makes union narrowable without enabling strict | engine.ts (processSegmentExpansionRequestAtBoundary), persistence.ts (ReconstructResult) |
| `RuntimeRegistry` not re-exported from `process-registry.ts` | Either re-export OR import directly from `types.ts` in execution.ts | execution.ts:162,170 |
| Missing imports in engine.ts: `sweepStaleArtifacts`, `formatPreflightSweep`, `rotateSupervisorLogs`, `formatLogRotation` | Add to existing `./cleanup.ts` import block (functions exist, just not imported) | engine.ts:2597–2624 |
| `EXEC_MISSING_TASK_FOLDER` not in `ExecutionErrorCode` union | Add to type union (real new code uses it; type union missed the addition) | types.ts:921 |
| `execLog(extra: Record<string, string\|number\|boolean>)` too narrow | Widen to `Record<string, unknown>` — callers already pass arrays/objects; runtime `${v}` stringifies all values; no behavior change | execution.ts:94 |
| `MonitorState.totalDone/totalFailed` and `LaneMonitorSnapshot.currentStep/completedChecks` referenced in extension.ts but DON'T EXIST on the types | **REAL BUG** — dashboard's change-detection silently broken (always sees no change beyond currentTaskId); fix to use `tasksDone`, `tasksFailed`, `currentTaskSnapshot?.currentStepNumber`, `currentTaskSnapshot?.totalChecked` | extension.ts:2409–2415 |
| `config.failure?.maxWorkerMinutes` should be `max_worker_minutes` | **REAL BUG** — typo means config-set max-worker-minutes was always silently ignored, falling through to 120 default; fix honors operator config (intended behavior) | execution.ts:2902 |
| `config.project?.name` reads non-existent `project` field on `OrchestratorConfig` | Replace with `extraEnvVars?.TASKPLANE_PROJECT_NAME \|\| "project"` to align with how project name flows in the rest of the code (lane-runner.ts:668 uses `TASKPLANE_PROJECT_NAME`) — same fallback behavior as today | execution.ts:2899 |
| `batchState.tasks.find(...)` references non-existent `tasks` field on `OrchBatchRuntimeState` | **REAL BUG** — would crash at runtime if hit (`undefined.find`); replace with `laneForTask?.tasks.find(t => t.taskId === taskId)?.task` (uses ParsedTask which has segmentIds/activeSegmentId) | resume.ts:2369 |
| `taskName: taskId` field added to `PersistedTaskRecord` via cast | Field doesn't exist on the type and no consumer reads `.taskName` from persisted records (only from ParsedTask) — remove dead assignment | persistence.ts:2516 |
| `m.packet.packetRepoId` / `m.packet.packetTaskPath` reads on `PacketPaths` | Fields don't exist on `PacketPaths` (they exist on `PersistedTaskRecord` and `ParsedTask`); current code always reads undefined and never enters the if-branches — remove dead branches; `m.repoId` is preserved separately | persistence.ts:2527–2530 |
| `prefs.spawnMode === "tmux"` migration check is dead | Type is already `"subprocess"` only; raw input is migrated at line 169 BEFORE assignment to typed prefs object. Lines 886–888 are dead. Remove. | config-loader.ts:886 |
| `as Record<string, unknown>` casts in config-loader and persistence | Use 2-step `as unknown as Record<string, unknown>` for legitimate widening of structured types to property-bag form (TS-explicit, semantically correct) | config-loader.ts:1007/1028, persistence.ts:1506/2528/2530 |
| `Partial<TaskplaneConfig>` too shallow for nested-section assignment | Change `loadProjectOverrides` return type and `migrateProjectOverrides` parameter to `DeepPartial<TaskplaneConfig>` (already exported from config-schema.ts) | config-loader.ts:1003,1070 |
| `(batchState.phase as OrchBatchPhase) === "..."` workaround already in use | Existing pattern in resume.ts — phase narrowing on object property persists across mutations under `strict:false`; mirror at lines 3299/3340 by hoisting to a local `OrchBatchPhase`-typed variable | resume.ts:3299/3340 |
| `ctx.ui.custom<T>(...)` rejected because `ExtensionContext = any` shim is too loose for type arguments | **Extend pi-shim** to declare `ExtensionContext` as an interface with `ui.custom<T>` signature; preserves backward compat via index signatures so non-`custom` access continues to typecheck | settings-tui.ts:1427/1526/1717/2035 (4 errors); pi-shims.d.ts:34,84 |
| `spawnMergeAgentV2` declared `Promise<AgentHostResult>` but never returns | Function is fire-and-forget (line 912 says "Fire-and-forget"); change return type to `Promise<void>` to match actual semantics; callers `await` but ignore return value | merge.ts:752–762 |
| `parsed.status` typed as `unknown` after JSON parse, fails `VALID_MERGE_STATUSES.has()` | Hoist normalized value to a local `const normalizedStatus = String(parsed.status).toUpperCase()` before the `.has()` check | merge.ts:225,415 |

### Per-category strategy

| Category | Count | Strategy | Real bug? |
|---|---|---|---|
| TS2339 (Property does not exist) | 63 | **Per-occurrence investigation.** Source-side: many catch real bugs (extension.ts dashboard fields, resume.ts batchState.tasks). Test-side: nearly all are mock-object accesses where the test's mock is missing fields. Fix by adding fields to mocks (Step 4) or fixing real-bug callers (Step 3). | Mixed |
| TS2741 (Property X missing in type) | 52 | **Test-side mock-drift.** All require adding missing fields with semantically-correct values. Use shared `makeOrchestratorConfig()` helper to dedupe. | Drift |
| TS2345 (Argument not assignable) | 30 | **Caller's argument shape wrong.** Mock-config arguments missing fields, OR widen `execLog` extra type. | Drift / type-too-narrow |
| TS2554 (Wrong number of arguments) | 23 | **API signature drift.** Update call sites to match. Investigate per-occurrence — may indicate an API renamed. | Drift |
| TS2367 (Comparison appears unintentional) | 21 | **Often real bugs.** config-loader "tmux" check is dead; resume.ts phase comparisons are TS narrowing artifacts. Investigate each. | Mixed |
| TS2322 (Type assignment mismatch) | 19 | **Mostly type drift.** Includes the `string[]` → execLog extra mismatches (resolved by widening execLog). | Drift |
| TS2739 (Type missing properties from another) | 12 | **Mock-config drift.** Same root cause as TS2741 — helper dedupes. | Drift |
| TS2769 (No overload matches call) | 7 | Per-occurrence investigation. | Mixed |
| TS2353 (Object literal may only specify known properties) | 7 | Mock objects with stale/extra fields. Remove or rename. | Drift |
| TS2352 (Conversion may be a mistake) | 7 | Use 2-step `as unknown as X` for legitimate widenings. | Type-too-narrow |
| TS2559 (Type has no properties in common) | 4 | Per-occurrence — likely full schema mismatch. | Drift |
| TS2347 (Untyped function calls + type args) | 4 | All in settings-tui.ts — fixed by extending `ExtensionContext` shim. | Shim limitation |
| TS2578 (Unused @ts-expect-error) | 3 | Remove the unneeded directives — types now actually pass. | Stale suppression |
| TS2304 (Cannot find name) | 3 | Missing imports (engine.ts cleanup helpers). | Drift |
| TS2871 (Always nullish) | 2 | Per-occurrence — indicates a check that's always false. Investigate. | Real bug |
| TS2694 (Namespace has no exported member) | 2 | Re-export type from process-registry.ts OR import directly from types.ts. | Re-export gap |
| Singletons (TS2305/2552/2551/2355/2561) | 5 | Per-occurrence judgment. | Mixed |

### Anti-shortcut policy (reaffirmed)

- **NO `as any`** — ever. Every cast must be a 2-step widening (`as unknown as X`) and only when the runtime intent is structurally correct.
- **NO `// @ts-expect-error` suppressions without an explicit justification comment** naming the underlying TS issue or shim limitation. The 3 existing `TS2578` ("unused @ts-expect-error") errors will be REMOVED, not added to.
- **NO garbage default values** to satisfy required-field checks. Every mock-object missing-field fix uses the schema-defined value (look up the type and use the meaningful default).
- **NO `Object.assign({}, ..., { ... } as Type)` casts.** Build mock objects with full required-field coverage via the helper or explicit literal.
- **For real bugs** discovered during fixes, document in Discoveries; if the fix would meaningfully change runtime behavior, the change-honoring-config or honoring-real-data fix is preferred (the typecheck gate's purpose is exposing these latent bugs). If the change would be operator-surprising, escalate.

### Order of attack

**Step 2 (mechanical autofixes):** None safe. Skip with note in Discoveries (every fix needs judgment per anti-shortcut policy).

**Step 3 (runtime source first, ~68 errors across 8 files):**
1. **types.ts** — add `EXEC_MISSING_TASK_FOLDER` to ExecutionErrorCode (used by execution.ts:2385).
2. **process-registry.ts** — re-export `RuntimeRegistry` so dynamic-import references in execution.ts resolve. Cleanest fix.
3. **execution.ts** — (20 errors): import `RuntimeRegistry`, fix `config.project?.name`, fix `maxWorkerMinutes` typo, widen `execLog` extra type (signature change cascades to engine.ts/resume.ts), drop dead `config.orchestrator?.batchId`.
4. **engine.ts** — (11 errors): add 4 missing imports from cleanup.ts, fix discriminated-union narrowing on `processSegmentExpansionRequestAtBoundary` return type, the rest auto-resolve from execLog widening.
5. **persistence.ts** — (8 errors): fix `ReconstructResult` discriminated-union narrowing, drop `taskName`, drop dead `m.packet.packetRepoId/packetTaskPath` reads, use 2-step casts.
6. **resume.ts** — (8 errors): fix `batchState.tasks` lookup, hoist phase to local var for narrowing, the rest auto-resolve from execLog widening.
7. **extension.ts** — (8 errors): fix `MonitorState.tasksDone/tasksFailed` field names, fix snapshot drilling to `currentTaskSnapshot?.currentStepNumber/totalChecked`.
8. **config-loader.ts** — (5 errors): drop dead tmux check, use 2-step casts, change return type to DeepPartial.
9. **settings-tui.ts** — (4 errors): no source change — fix by extending pi-shim.
10. **merge.ts** — (4 errors): hoist normalized status, change return type to Promise<void>, the rest auto-resolve from execLog widening.
11. **pi-shims.d.ts** — extend `ExtensionContext` interface for typed `ui.custom<T>()`.

**Step 4 (test-side, ~196 errors across 37 files):**
1. Introduce `extensions/tests/helpers/mock-orchestrator-config.ts` factory.
2. Refactor top-2 files to use the helper (workspace-config.integration, worktree-lifecycle.integration). Should drop ~30+ errors.
3. Refactor remaining test files — some will need targeted local fixes (typo'd field names, stale @ts-expect-error etc.) instead of the helper.
4. After each test file: run that file in isolation. 
| Runtime-source errors: 68 across 8 files | Tackle first (Step 3) | execution.ts(20), engine.ts(11), resume.ts(8), persistence.ts(8), extension.ts(8), config-loader.ts(5), settings-tui.ts(4), merge.ts(4) |
| Test-side errors: 196 across ~38 files | Tackle second (Step 4) | top: workspace-config.integration.test.ts(26), resume-bug-fixes.test.ts(26), non-blocking-engine.test.ts(18), orch-state-persistence.test.ts(10), auto-integration.integration.test.ts(10) |
| Test baseline: 3624 / 1 skipped / 0 failed | Target to preserve | `npm run test:fast` |

### Live error inventory (Step 0 baseline)

Total: **264 errors** in 45 files (8 source + 37 test files).

**Top categories:**

| Category | Count | Meaning |
|---|---|---|
| TS2339 | 63 | Property does not exist on type — investigate per-occurrence (real bug or missing type field) |
| TS2741 | 52 | Property X missing in type — mock object incomplete vs schema |
| TS2345 | 30 | Argument not assignable — caller's shape wrong |
| TS2554 | 23 | Wrong number of arguments — API signature drift |
| TS2367 | 21 | Comparison appears unintentional — often catches real bugs |
| TS2322 | 19 | Type assignment mismatch |
| TS2739 | 12 | Type missing properties from another type |
| TS2769 | 7 | No overload matches call |
| TS2353 | 7 | Object literal may only specify known properties |
| TS2352 | 7 | Conversion of type may be a mistake (between/cast) |
| TS2559 | 4 | Type has no properties in common |
| TS2347 | 4 | Untyped function calls may not accept type arguments |
| TS2578 | 3 | Unused @ts-expect-error directive |
| TS2304 | 3 | Cannot find name |
| TS2871 | 2 | Expression is always nullish |
| TS2694 | 2 | Namespace has no exported member |
| TS2305 / TS2552 / TS2551 / TS2355 / TS2561 | 1 each | Various |

**Per-file breakdown (top runtime-source files — Step 3 targets):**

| File | Count |
|---|---|
| extensions/taskplane/execution.ts | 20 |
| extensions/taskplane/engine.ts | 11 |
| extensions/taskplane/resume.ts | 8 |
| extensions/taskplane/persistence.ts | 8 |
| extensions/taskplane/extension.ts | 8 |
| extensions/taskplane/config-loader.ts | 5 |
| extensions/taskplane/settings-tui.ts | 4 |
| extensions/taskplane/merge.ts | 4 |

**Per-file breakdown (top test files — Step 4 targets):**

| File | Count |
|---|---|
| extensions/tests/workspace-config.integration.test.ts | 26 |
| extensions/tests/resume-bug-fixes.test.ts | 26 |
| extensions/tests/non-blocking-engine.test.ts | 18 |
| extensions/tests/orch-state-persistence.test.ts | 10 |
| extensions/tests/auto-integration.integration.test.ts | 10 |
| extensions/tests/supervisor-recovery-flows.test.ts | 8 |
| extensions/tests/supervisor-onboarding.test.ts | 8 |
| extensions/tests/retry-matrix.test.ts | 8 |
| extensions/tests/partial-progress.integration.test.ts | 8 |
| extensions/tests/orch-supervisor-tools.test.ts | 7 |
| extensions/tests/monorepo-compat-regression.test.ts | 6 |
| extensions/tests/path-resolver-pi-scope.test.ts | 5 |
| extensions/tests/discovery-routing.test.ts | 5 |
| ... 24 more files | 1–4 each |


---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-10 17:56 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 17:56 | Step 0 started | Preflight |
| 2026-05-10 | Step 0 complete | 264 errors in 45 files; baseline tests 3624/1/0 |

---

## Blockers

*None unless Step 0's TP-191 pre-condition check fails*

---

## Notes

**Sage's split (post-TP-191 review):**
- ~198 errors in tests (mostly `extensions/tests/workspace-config.integration.test.ts` and `worktree-lifecycle.integration.test.ts`)
- ~69 errors in runtime source

The above counts are sage's estimate based on a sample run; the live count in Step 0 may diverge slightly. Use the live count as the authoritative target.

**Top error categories (from sage's run on TP-191's merge commit):**

| Category | Count | Typical fix |
|---|---|---|
| TS2339 | 63 | Investigate per-occurrence — could be real bug or missing type field |
| TS2741 | 52 | Add missing field to mock object with correct schema-defined value |
| TS2345 | 30 | Fix the caller's argument shape, not the callee's signature |
| TS2554 | 23 | Update call site to match the API signature |
| TS2367 | 21 | Investigate carefully — often catches real bugs |
| TS2322 | 19 | Type narrowing or interface refinement |

**Anti-shortcut policy (CRITICAL):**

The whole point of typecheck-as-a-gate is catching real bugs. A worker that uses `as any` or `// @ts-expect-error` shortcuts to make the type checker happy is defeating the purpose. The plan reviewer and code reviewer must both verify that NO such shortcuts appear in the diff. If a fix legitimately needs a `@ts-expect-error`, the comment MUST justify it (e.g., naming the underlying TypeScript issue or pi-package shim limitation).

**Strict mode is OUT of scope.** This task delivers typecheck-clean at CURRENT strictness only (`strict: false, noImplicitAny: false`). Strictness ratchet is a separate post-TP-194 follow-up that can decide later whether to do all-at-once strict or per-flag ratchet.
