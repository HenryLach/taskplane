# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.30.0] - 2026-05-10

### Fixed

- **Preflight cleanup feature now actually runs (TP-195):** `runOrchBatch`
  in `extensions/taskplane/engine.ts` referenced `sweepStaleArtifacts`,
  `formatPreflightSweep`, `rotateSupervisorLogs`, and `formatLogRotation`
  inside the preflight-cleanup try-block, but those identifiers were
  never imported from `./cleanup.ts`. At runtime the first reference
  threw a ReferenceError that the enclosing catch-all swallowed, so
  Layers 2–5 of preflight cleanup (age-based artifact sweep, supervisor
  log rotation, telemetry size cap, prior-batch artifact cleanup) had
  been silently a no-op since TP-065 / #221 (․2024-09). The missing
  imports were uncovered by the TP-191 typecheck script; this fix adds
  them so the advertised cleanup runs on every batch. Regression test:
  `tests/lane-runner-v2.test.ts 3.10` asserts the four helpers are
  imported from `./cleanup.ts`.
- **`max_worker_minutes` config field is honored (TP-195):** Lane-runner
  config in `executeLaneV2` (`extensions/taskplane/execution.ts`) was
  reading a non-existent `config.failure?.maxWorkerMinutes` camelCase
  alias — always undefined — silently ignoring any operator-set value
  on `OrchestratorConfig.failure.max_worker_minutes` and always falling
  through to the hard-coded `120`-minute default. Fixed to read the
  canonical snake_case field. Operators with `max_worker_minutes`
  configured in `.pi/taskplane-config.json` will now have their
  configured limit honored; default of 120 preserved when the field is
  unset. Regression test: `tests/lane-runner-v2.test.ts 3.9` asserts
  the corrected accessor and absence of the typo.
- **Resume’s failed-task supervisor-alert path no longer crashes
  (TP-195):** When `/orch-resume` encountered a failed task during a
  wave, the supervisor-alert emission block in `resume.ts` called
  `batchState.tasks.find(…)`, but `OrchBatchRuntimeState` has no
  `tasks` field (only `PersistedBatchState` does). The runtime call
  would throw `TypeError: undefined.find is not a function`. The
  failed-task path was never covered by tests, so the crash never
  surfaced. Replaced with a lookup against `laneForTask?.tasks.find
  (…)?.task` — the lane-allocated `ParsedTask` payload carries the
  same `segmentIds`/`activeSegmentId` data the alert needs.
  Regression test: `tests/resume-bug-fixes.test.ts 4.1`.

### Internal

- **Code-quality gates active (TP-194)**

  The final task packet implementing the code-quality-gates spec
  ([`docs/specifications/taskplane/code-quality-gates.md`](docs/specifications/taskplane/code-quality-gates.md),
  section 6.4). Flips three static-analysis checks from advisory to
  required CI gates: `Typecheck` (new — `tsc --noEmit` against
  `extensions/tsconfig.ci.json`), `Lint (Biome)` (was already wired
  but ran with `continue-on-error: true` until now), and
  `Format check (Biome)` (new — `biome format --no-errors-on-unmatched .`).
  `.github/workflows/ci.yml` runs the three steps in order before the
  existing `Run tests` step inside the single `ci` job, so any failure
  short-circuits the rest of the pipeline. The existing required `ci`
  branch-protection context already covers the new gates because a
  step failure fails the whole job.

  Reviewer-agent activation: the TP-188 quality-check verification
  section in `templates/agents/task-reviewer.md` is now fully active.
  The temporary activation note added in TP-191 (which previously
  surfaced quality-check failures as Issues Found without downgrading
  the verdict) is removed; failing typecheck/lint/format:check now
  unconditionally downgrades APPROVE → REVISE during code review.
  Documentation updates: `AGENTS.md` adds the three commands to the
  validation checklist; `docs/maintainers/release-process.md` adds
  them to the pre-release checks and pre-release checklist;
  `docs/maintainers/development-setup.md` gets a new
  "Code-quality gates (required for every PR)" section. The
  long-missing `lint:fix` npm script (referenced by these docs) is
  added to `package.json`.

  **Operator handoff (verification-only):** no branch-protection
  changes are required. After this PR merges, verify via
  `gh api repos/HenryLach/taskplane/branches/main/protection`
  that `required_status_checks.contexts` still contains `ci` (it
  does today). If at some future point per-gate visibility in
  branch protection is desirable, the follow-up is to split the
  gates into separate jobs in `ci.yml` — out of scope for TP-194
  per the spec's Tier-1.5 follow-up list.

- **Code-quality typecheck cleanup (TP-195):** Fourth of four sequenced
  packets implementing the code-quality-gates spec
  ([`docs/specifications/taskplane/code-quality-gates.md`](docs/specifications/taskplane/code-quality-gates.md)).
  Cleaned up the **264 typecheck errors** that TP-191 surfaced when it
  first made `npm run typecheck` runnable, so TP-194’s gate flip can
  promote typecheck from advisory to a CI gate. Final state:
  `npm run typecheck` exits 0 against `extensions/tsconfig.ci.json` at
  the current strictness (`strict: false`, `noImplicitAny: false`).
  **Per-category breakdown of fixes** (top categories at task start):
  TS2339 (63) — property-not-exist; TS2741 (52) — mock-object missing
  required fields; TS2345 (30) — caller-shape mismatch; TS2554 (23) —
  signature drift; TS2367 (21) — unintentional comparison; TS2322 (19)
  — assignment mismatch; TS2739 (12) — type missing properties; plus
  smaller TS2769/TS2353/TS2352/TS2559/TS2347/TS2578/TS2304/TS2871/
  TS2694 counts. **Source-side highlights:** 4 latent bugs uncovered
  and fixed (preflight-cleanup-feature no-op, `max_worker_minutes`
  typo, resume failed-task crash, plus an extension.ts dashboard
  change-detection that was reading non-existent fields and only ever
  refreshing on `currentTaskId` — dropped the dead comparisons,
  observable behavior unchanged); widened `execLog`’s `extra`
  parameter from `Record<string, string\|number\|boolean>` to
  `Record<string, unknown>` (callers were already passing arrays/
  objects; template-string stringification preserved); re-exported
  `RuntimeRegistry` from `process-registry.ts`; documented optional
  `batchId?` field on `OrchestratorConfig.orchestrator`; added
  `EXEC_MISSING_TASK_FOLDER` to `ExecutionErrorCode`; fixed
  discriminated-union narrowing under non-strict mode by adding
  `reason?: undefined` / `error?: undefined` to success branches;
  switched `loadProjectOverrides` / `migrateProjectOverrides` /
  `loadJsonConfig` / `mergeProjectOverrides` to
  `DeepPartial<TaskplaneConfig>`; changed `spawnMergeAgentV2` return
  type to `Promise<void>` (fire-and-forget). **Test-side highlights:**
  introduced shared `tests/helpers/mock-orchestrator-config.ts`
  factories (`makeOrchestratorConfig`/`makeTaskRunnerConfig`) that
  wrap `DEFAULT_*_CONFIG` defaults from `types.ts` so test mocks stay
  in sync with the runtime schema; added `expect.unreachable()` and
  optional 2nd `message` arg to `expect()` (Vitest-compat surface that
  ~190 sites already relied on); fixed phase-narrowing in 9.x
  launch-window suite via typed `OrchBatchPhase` casts; updated
  `LaneRunnerConfig` / `PersistedTaskRecord` / `MergeResult` /
  `BatchSummaryData` / `MinimalBatchState` / `WorkspaceRoutingConfig`
  fixtures to match current schemas; replaced legacy `RuntimeAgentStatus`
  `"complete"` with canonical `"exited"`; converted `it(name, fn,
  30000)` calls to `it(name, { timeout: 30000 }, fn)` for node:test
  compatibility; declared `mock.fn<(…args: any[]) => any>()` so
  `mockImplementation` accepts non-undefined returns. **Anti-shortcut
  policy enforced:** zero new `as any` casts; zero `@ts-expect-error`
  added (the 3 unused-directive errors were removed); only legitimate
  2-step `as unknown as X` widenings with justifying comments; no
  garbage default values — every mock-object missing-field fix uses
  a schema-defined value. **Pi-shim** extended `ExtensionContext`
  from `any` to a structural interface so `ctx.ui.custom<T>()`
  typechecks at 4 settings-tui.ts call sites; `ui` left optional so
  thin test mocks (e.g., `{ model: null }`) still satisfy the type.
  After the pass: `npm run typecheck` exits 0;
  `npm run lint` / `npm run format:check` unchanged from baseline;
  test suite **3627 passing / 1 skipped / 0 failed** (TP-191
  baseline 3624 + 3 new TP-195 regression tests for the
  fix-the-bug paths). **Strict mode remains out of scope** — the
  strictness ratchet (enabling `strict: true` /
  `noImplicitAny: true`) is a separate post-TP-194 follow-up. With
  this packet merged, TP-194’s typecheck-gate flip CRITICAL
  pre-condition (“`npm run typecheck` exits 0 on `main`”) is
  satisfied.
- **Code-quality formatter adoption (TP-193):** Third of four sequenced
  packets implementing the code-quality-gates spec
  ([`docs/specifications/taskplane/code-quality-gates.md`](docs/specifications/taskplane/code-quality-gates.md)
  section 6.3). Enabled the Biome formatter and applied it once across
  the entire codebase in a single mechanical commit. **Formatter rules**
  pinned in `biome.json` per spec section 6.3.1: `indentStyle: "tab"`,
  `indentWidth: 1`, `lineWidth: 100`, `lineEnding: "lf"`,
  `quoteStyle: "double"`, `trailingCommas: "all"`, `semicolons: "always"`,
  `arrowParentheses: "always"`. **Format pass** touched 161 files
  (every TS/MJS file in scope) with cosmetic-only changes — line
  wrapping, trailing-comma insertions, single-param arrow parens, and a
  small number of quote-style switches where Biome's smart-quote rule
  picked the alternative quote when the primary was inside the string.
  No semantic changes. **Test resilience prep** preceded the format
  pass in a separate commit: introduced `expect().toContainNormalized()`
  (whitespace + bracket-padding + trailing-comma normalized substring
  match) and updated 22 distinct source-grep test assertions across
  ~20 test files to use the helper or pre-normalize source before
  matching; bumped fixed-size source-slice windows in retry-matrix,
  spawn-failure-visibility, supervisor-recovery-flows, and tier0-watchdog
  tests so vertically-rewrapped multi-arg calls don't push expected
  needles outside the inspected window. **`tmux-reference-audit.mjs`**
  was extended to skip strict-mode functional-usage detection inside
  test files, because Biome's quote-style switch unmasked literal
  assertion strings like `"execSync('tmux list-sessions"` that would
  otherwise flag the audit. **`.git-blame-ignore-revs`** added at the
  repo root listing the format-adoption commit SHA so `git blame`
  doesn't bottom out on the bulk reformat; per-developer one-time
  setup (`git config blame.ignoreRevsFile .git-blame-ignore-revs`)
  documented in `docs/maintainers/development-setup.md`. After the
  pass: `npm run format:check` exits 0; `npm run lint` exits 0
  (TP-192 cleanup preserved); test suite unchanged at **3624 passing /
  1 skipped / 0 failed**. The `format:check` gate flip is TP-194's scope.
- **Code-quality lint cleanup (TP-192):** Second of four sequenced packets
  implementing the code-quality-gates spec
  ([`docs/specifications/taskplane/code-quality-gates.md`](docs/specifications/taskplane/code-quality-gates.md)
  section 6.2). Fixed all 9 pre-existing Biome lint errors in `main` so
  TP-194 can promote `npm run lint` from advisory to a CI gate without
  breaking the build. Errors fixed by category: **`noImplicitAnyLet` × 5**
  — added explicit type annotations to regex-exec loop variables
  (`let m: RegExpExecArray | null;`) in `lane-runner.ts` and
  `task-executor-core.ts` (3 sites), and to a `readdirSync` result
  (`let entries: Dirent[];`) in `merge.ts` (added matching `type Dirent`
  to the existing `node:fs` import). **`noControlCharactersInRegex` × 1**
  — in `verification.ts`, converted `ANSI_REGEX` from a regex literal
  containing `\u001b\u009b` escapes to `new RegExp("...", "g")` with an
  escaped string body; runtime behavior is identical (the rule only
  inspects regex literals, not constructor strings). The stale
  `// eslint-disable-next-line no-control-regex` comment was dropped
  (this repo has no ESLint). **`noRedeclare` × 2** — in `waves.ts`,
  removed `AllocateLanesResult` from the type-import on line 10 (it was
  not actually exported from `./types.ts`; the local
  `export interface AllocateLanesResult` at line 1072 is the canonical
  declaration); in `tests/orch-state-persistence.test.ts`, renamed the
  duplicate `resolveRepoRoot` test helper in section 8.1 to
  `resolveRepoRootMixedRepo` and updated its 14 in-section callers
  (bodies are functionally identical, so behavior is preserved; the
  section-7 helper at line 4226 keeps its original name). **`noUnsafeFinally`
  × 1** — in `extension.ts` `withPreservedBatchHistory`, inverted
  `if (!snapshot) return;` (early-return inside a `finally` block) to
  `if (snapshot) { ... }` (conditional execution); same observable
  behavior, no `return` in `finally`. **No suppressions added** — every
  error received a real fix. Affected files: 7 source files
  (`extension.ts`, `lane-runner.ts`, `merge.ts`, `task-executor-core.ts`,
  `verification.ts`, `waves.ts`) plus 1 test file
  (`orch-state-persistence.test.ts`). After cleanup: `npm run lint`
  exits 0 (was: 9 errors); typecheck dropped from 267 to **264 errors**
  (incidental, from explicit regex-exec type annotations — new TP-194
  baseline); test suite unchanged at **3624 passing / 1 skipped /
  0 failed**.
- **Code-quality prep — scripts, tool pinning, pi-shims (TP-191):** First of
  four sequenced packets implementing the code-quality-gates spec
  ([`docs/specifications/taskplane/code-quality-gates.md`](docs/specifications/taskplane/code-quality-gates.md)).
  This packet is **prep only** — no gating changes, no behavior changes,
  no lint cleanup. (1) **Scripts** — added a root `package.json` `scripts`
  block with `typecheck` (`tsc --project extensions/tsconfig.ci.json --noEmit`),
  `lint` (`biome lint .`), `format` (`biome format --write .`), and
  `format:check` (`biome format .`). Names match the reviewer-agent's
  TP-188 discovery list verbatim. (2) **Tool pinning** — added
  `@biomejs/biome@2.4.15`, `typescript@5.6.3`, and `@types/node@22` to
  root `devDependencies`, removing the `npx ...@latest` drift from CI.
  (3) **Pi-shims** — new `extensions/types/pi-shims.d.ts` declares minimal
  type stubs for both `@earendil-works/*` AND `@mariozechner/*` Pi packages
  (pi-coding-agent, pi-ai, pi-tui) so headless `tsc --noEmit` resolves
  imports without the actual pi packages installed locally. (4) **CI
  tsconfig** — new `extensions/tsconfig.ci.json` extends the editor-facing
  `tsconfig.json` (untouched) with comprehensive `include`, `paths`
  mapping pi specifiers to the shim, and `typeRoots` pointing to root
  `@types/node`. `tsconfig.test.json` updated to add `@earendil-works/*`
  mappings alongside legacy `@mariozechner/*` (back-compat preserved).
  (5) **Biome modernized** — `biome.json` `$schema` URL updated to
  `2.4.15`, deprecated `experimentalScannerIgnores` migrated to negation
  patterns inside `includes` (Biome 2.2+ canonical syntax), scope
  expanded to cover `bin/**/*.mjs`, `scripts/**/*.mjs`, and
  `extensions/**/*.tsx`; tests now in scope (sage's recommendation per
  spec section 7.2); `dashboard/public`, `extensions/types`, `.pi`,
  `.worktrees` excluded; formatter still disabled (TP-193 enables).
  (6) **Reviewer discoverability** — `.pi/taskplane-config.json`
  `taskRunner.testing.commands` now declares `typecheck`, `lint`,
  `format:check` (and the existing `test`); `templates/agents/task-reviewer.md`
  carries a temporary activation note explaining that typecheck/lint/format:check
  failures surface as Issues Found but do NOT downgrade APPROVE→REVISE
  until TP-194 lands (note removed in TP-194). (7) **CI workflow** —
  `.github/workflows/ci.yml` lint step now runs `npm run lint` (still
  `continue-on-error: true` until TP-194); added `Install root dev
  dependencies` step before lint and updated the Node setup-action
  cache-dependency-path to include both root and extensions lockfiles.
  Captured baselines for TP-194's gating decision: **267 typecheck
  errors** and **9 lint errors / 277 warnings / 660 infos across 175 files**.
  All 3624 tests still pass (1 skipped, 0 failed) — zero behavior changes.

## [0.29.2] - 2026-05-10

### Internal

- **Migrate `peerDependencies` from `@mariozechner/*` to `@earendil-works/*` and mark them optional:** every `pi update` was printing four `npm warn deprecated` lines (one for each `@mariozechner/pi-*` package the new pi packages tell npm they are deprecating). Pi v0.74.0+ ships under the `@earendil-works` scope; the legacy `@mariozechner` peer-dep entries in taskplane's `package.json` made npm resolve the deprecated packages and surface the warnings on every install. Fix: switch the four pi-related entries in `peerDependencies` to `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai` (kept `@sinclair/typebox` unchanged — not pi-managed); add a `peerDependenciesMeta` block marking all three pi packages `optional: true` so npm doesn't generate unmet-peer warnings for users in transitional setups, and so we don't tell users they MUST have pi globally installed at npm-install time (pi is the runtime, not a strict install-time peer).

  **No source-code changes.** The `import` statements in `extensions/*.ts` continue to reference `@mariozechner/*` because Pi's runtime extension loader (`<pi>/dist/core/extensions/loader.js`) bundles aliases for BOTH scopes — imports resolve identically regardless of which scope name is used. Changing the import statements would break compat for users still on Pi < v0.74.0 (the alias map was added in v0.74.0). The `peerDependencies` declaration is informational only; the runtime resolution is unaffected by either approach.

  **No tests changed; no behavior changed.** Tests pass at the v0.29.1 baseline (3624 passing / 1 skipped / 0 failed).

## [0.29.1] - 2026-05-10

### Fixed

- **Runtime V2 spawn failures now visible (TP-190, #561):** Previously,
  when a Runtime V2 lane spawn failed at the very first call site (Pi CLI
  not findable, worktree provisioning error, branch collision), the lane
  was *not* transitioned to `failed`. The engine continued polling
  indefinitely, the dashboard showed green/running lanes that had no
  actual worker process, `orch_status()` reported `executing`, and no
  supervisor alert fired. Recovery required the operator to manually
  `tail` engine-worker stderr — not in any documented diagnostic place.
  This bug masked the operator-side impact of #559 (orchestrator IPC
  crash) and #560 (`@earendil-works` rename), making both look like
  hangs rather than immediate spawn errors. Fix has four parts:
  (1) **State transition** — the existing per-task try/catch in
  `executeLaneV2` now tags the failed `LaneTaskOutcome` with
  `exitDiagnostic.classification = "spawn_failure"` (a new
  `ExitClassification` value alongside `process_crash`, `stall_timeout`,
  etc.) and writes a synthetic terminal `RuntimeLaneSnapshot` so
  `monitorLanes` resolves the lane to terminal state instead of looping
  forever on the never-written snapshot file (the actual root cause of
  the silent hang). (2) **No-retry policy** — `spawn_failure` is
  intentionally NOT in `TIER0_RETRYABLE_CLASSIFICATIONS` because
  spawn-stage errors are never transient; a defense-in-depth early
  return in `attemptWorkerCrashRetry` produces an operator-friendly log
  line. (3) **IPC alert** — the `task-failure` supervisor alert payload
  now carries `context.exitCategory` (and a "Spawn failure: … escalate
  immediately" summary line when applicable) so the supervisor playbook
  can branch on spawn-stage failures and escalate without retrying. The
  same wiring is mirrored in `resume.ts` for `/orch-resume` parity.
  (4) **Phase transition** — when every task in a wave fails with
  `classification === "spawn_failure"`, `batchState.phase` transitions
  from `"executing"` to `"failed"` (not `"paused"`, because the operator
  cannot un-stick spawn failures without changing something external).
  Validation: 33 new behavioral + helper tests in
  `extensions/tests/spawn-failure-visibility.test.ts`; full fast suite
  3620 pass / 1 skipped / 0 failed (+33 from baseline 3587);
  cross-platform Node 24 CI.

  **Sage post-merge fold:** two important correctness issues caught by
  sage's review of the merged TP-190 work, both folded before public
  release. (a) **Residual hang on snapshot-write failure**: the spawn-
  failure catch's `writeLaneSnapshot()` is best-effort, but the original
  comment claimed a 30-second staleness fallback would recover — not
  true when `snap == null` (no file at all), because `snap?.updatedAt`
  is `undefined` so `staleMs == 0` and the 30-second check never fires.
  Snapshot-write failure (disk full, permission, transient I/O) would
  have left `sessionAlive = true` indefinitely, reintroducing the same
  #561 hang. Fix: added a null-snapshot tracker-age fallback in
  `resolveTaskMonitorState` — when `snap == null` AND the tracker has
  observed the task for ≥ 60s (past startup grace), consult the
  registry liveness check instead of defaulting to alive. (b)
  **Multi-segment edge in `isAllLanesSpawnFailedWave`**: the
  `succeededTaskIds.length !== 0` gate was the *terminal* completion
  projection, populated only when a multi-segment task reaches its
  final segment. A wave with a multi-segment task succeeding on
  segment 1 (with continuation scheduled) plus a single-segment task
  spawn-failing would have falsely tripped phase=failed, burying real
  progress. Fix: the helper now optionally accepts `laneResults` and
  scans per-task outcomes for any `status === "succeeded"`. 4 new
  sage-fold tests in `spawn-failure-visibility.test.ts` cover both
  edge cases. Final test count: 3624 passing (+4 over the 3620
  worker-batch baseline).

  **Polyrepo end-to-end verified by operator** in
  `C:/dev/tp-test-workspace`. The bug class that previously left
  lanes silently "running" forever now surfaces immediately as a
  visible failure with a meaningful `phase=failed` and `task-failure`
  IPC alert.

## [0.29.0] - 2026-05-09

### New

- **`supervisor_takeover(reason)` tool (TP-187, #538):** Non-destructive
  escape hatch for misbehaving batches. Pauses the running wave, drains
  every per-agent on-disk outbox for the current batch, and marks all
  active lanes as terminated so any in-transit zombie alerts are dropped
  before they reach the supervisor's user-message queue. Worktrees,
  branches, batch state, and sessions are all preserved — distinct from
  `orch_abort`, which kills sessions and deletes state. Use this when
  the batch is producing alert spam or has hit a death-spiral pattern
  but you may still want to resume the same batch. After takeover, call
  `orch_status()` to inspect, then either `orch_resume(force=true)` to
  continue (alert suppression is lifted automatically on resume) or
  `orch_abort()` to escalate to destructive shutdown. Documented in
  `templates/agents/supervisor.md` alongside the existing orch_* tool
  surface, plus a new section codifying the lane-runner's text-reply
  parser semantics (close keywords `skip` / `let it fail` / `close` /
  `abort` / `stop` are only treated as session-close directives when
  they appear in a reply under 30 characters; longer messages are
  always treated as instructional re-prompts).

### Fixed

- **Zombie supervisor alerts after lane termination (TP-187, #538):**
  Previously, when a worker lane was killed (no-progress threshold or
  hard-fail), 3–5 "wants to exit" alerts that the worker emitted before
  termination remained in the supervisor's user-message queue and the
  agent's on-disk outbox, where they could be re-discovered later.
  None of the documented operator responses (`steer`, `skip`, `let it
  fail`, `orch_abort`, `orch_skip_task`) reliably drained either path.
  Fix has three parts: (1) at every lane-termination decision point
  (no-progress kill in `lane-runner.ts`, hard-fail in `engine.ts`), the
  agent's outbox is now synchronously drained — pending `*.msg.json`
  files are moved to `outbox/processed/` and other pending files (e.g.,
  `segment-expansion-*.json`) are renamed to `.drained` so they are
  invisible to subsequent discovery scans; (2) the engine emits a new
  `lane-terminated` IPC message to the supervisor process, which keys
  a per-batch suppression filter (`terminatedLanes` /
  `terminatedAgents` Maps) that drops any subsequent supervisor-alert
  whose `context.laneNumber` or `context.agentId` matches before it
  reaches `pi.sendUserMessage`; (3) the engine emits a complementary
  `lane-respawned` IPC at the start of each `executeLaneV2` invocation
  so a fresh task on a re-allocated lane number lifts the suppression.
  The filter is also cleared on `orch_resume()`, on a new batch start,
  and on `supervisor_takeover()`-then-resume. Implementation: new
  `drainAgentOutbox` helper in `mailbox.ts`, `LaneTerminatedInfo` /
  `LaneTerminatedCallback` types in `types.ts`, callback threading
  through `engine.ts` / `execution.ts` / `resume.ts` / `engine-worker.ts`,
  and IPC + filter wiring in `extension.ts`.

- **`orch_resume(force=true)` cannot reattach after `orch_abort()`
  (TP-187, #539):** `executeAbort()` deletes `.pi/batch-state.json` to
  enforce its destructive contract, but the runtime registry, per-agent
  manifests, lane snapshots, worktrees, and branches all survive. With
  no batch-state.json, `loadBatchState()` returned null and force-resume
  returned the generic "no batch found" error, forcing operators into
  ~15 minutes of manual git surgery (fast-forward feature branches,
  push, remove worktrees, edit STATUS, re-`orch_start`) just to do what
  force-resume should have done. Fix adds a small `batch-meta.json`
  runtime artifact written at batch-start to
  `.pi/runtime/<batchId>/batch-meta.json` capturing the wave plan and
  the few non-recoverable scalars (baseBranch, orchBranch, mode,
  startedAt, totalWaves). On force-resume after abort, when
  `loadBatchState()` returns null, the new
  `reconstructBatchStateFromRuntime()` helper deterministically rebuilds
  a validator-compliant `PersistedBatchState` from the surviving
  artifacts: most-recent batch dir wins by mtime (lex tiebreak),
  `batch-meta.json` provides wave topology and orchBranch, worker
  manifests provide per-lane allocation, and the existing reconciliation
  pass re-detects succeeded tasks via `.DONE` markers and STATUS.md.
  When required artifacts are missing or validation fails, force-resume
  fails loud with a new `resumeNoStateAfterAbort` message that names
  the missing artifact and recommends `orch_start <PROMPT.md>` as the
  recovery path. The non-force `orch_resume()` path is unchanged.
  `orch_abort` itself remains semantically destructive — only
  force-resume reads from the surviving runtime artifacts.

- **`Worker said:` is empty in early no-progress alerts (TP-187, #540):**
  When a worker exits an iteration without producing a visible assistant
  message (a known failure mode in the death-spiral pattern), the
  worker-exit-intercept alert sent to the supervisor showed
  `Worker said: ""` — leaving the supervisor with no signal about why
  the worker is stuck on the iterations where intervention could still
  help. By the time the field has content, the worker is already at
  no-progress count 3 (kill threshold). Fix has two parts: (1)
  `templates/agents/task-worker.md` now requires a one-sentence reason
  before any silent exit-with-no-progress, with concrete examples; (2)
  `lane-runner.ts` falls back to walking the worker's `events.jsonl`
  backward to find the most recent non-empty `assistant_message`
  payload when the current turn produced no visible output, and tags
  the alert with which source (`current-turn`,
  `events-jsonl-fallback`, or `empty-sentinel`) produced the
  `Worker said:` field. The 500-character truncation invariant is
  preserved.

- **`taskplane doctor` no longer shows empty parens for `pi installed ()`
  (TP-189-C / TP-185 follow-up):** pi prints its `--version` output to
  **stderr**, but `bin/taskplane.mjs`'s `getVersion()` only captured
  stdout via `execSync(... { stdio: 'pipe' })`, so the doctor display was
  `✅ pi installed ()` with empty parens. The fix extracts `getVersion`
  to `bin/get-version.mjs` (testable ESM helper) and switches it to
  `spawnSync` with `stdio: ['ignore', 'pipe', 'pipe']`. The new logic
  prefers stdout but falls back to stderr when stdout is empty, and
  preserves the prior fail-safe contract (returns `null` on subprocess
  failure or non-zero exit — critical so shell error text isn't surfaced
  as a fake version string). Manual verification: `taskplane doctor` now
  shows `✅ pi installed (0.73.0)`. 7 new behavioral tests in
  `extensions/tests/cli-doctor-version-capture.test.ts` cover the
  stdout-precedence, stderr-fallback, trim, and null-on-failure cases.
- **`isStepMarkedComplete` death-spiral guard now skips fenced code
  blocks (TP-189-A3 / TP-186 follow-up):** the helper that powers the
  `review_step` REFUSED guard scanned STATUS.md line-by-line for the
  literal `**Status:** ✅ Complete` pattern. If a step's body documented
  that pattern inside a fenced code block (legitimate authoring of the
  format itself), the guard would false-positive and refuse a legitimate
  code review. The helper now uses CommonMark-aware fence tracking:
  recognizes both ``` and ~~~ fences, tracks the opener char + length,
  and only closes on a matching delimiter (same char, length ≥ opener
  length, no trailing non-whitespace text). Mixed-delimiter examples and
  `````info-string lines inside an outer fence no longer prematurely
  close it. Step-heading detection is gated on being outside a fence so
  a `### Step N:` line inside a code-block sample is treated as content
  rather than a step boundary. 6 new unit tests cover the edge cases.

### Docs

- **`templates/agents/task-worker.md` reconciled with TP-186's Order of
  Operations rule (TP-189-E):** two older sections were ambiguous when
  read alongside the new review-gated step-completion contract from
  TP-186. (1) Resume Algorithm step 6 ("all items checked → proceed to
  next step") now splits behavior by Review Level: 0/1 may proceed,
  but 2/3 must commit the implementation, call
  `review_step(type="code")`, and only flip the per-step `**Status:**`
  heading after APPROVE — with a cross-reference to the Order of
  Operations section. (2) The Checkpoint Discipline / Git commits
  example commit message changed from `feat(TASK-ID): complete Step N
  — description` to `feat(TASK-ID): step N implementation`, plus
  explicit Level 0/1 vs Level 2/3 paragraphs and a separate
  `chore(TASK-ID): step N complete (code review APPROVE)` example for
  the post-APPROVE status-flip commit. Both edits reuse canonical
  wording from the Order of Operations + Recovery Recipe sections so
  the existing source-pattern tests in
  `extensions/tests/worker-step-completion-protocol.test.ts` continue to
  pass; a new test 1.4b regression-guards the Resume Algorithm wording.
- **`skills/create-taskplane-task/SKILL.md` Complexity Assessment
  augmented with **Per-Step Reviews vs. Consolidated Reviews
  (Checkpoint Markers)** sub-section (TP-189-E):** the existing rubric
  documents Review Levels 0–3 but not the second axis — *how many*
  reviews fire for a given level. PROMPT authors had been discovering
  this empirically (e.g., TP-186 fired only 2 reviews via checkpoint
  markers vs the default ~8 it would have fired without them). The new
  sub-section makes the choice explicit: per-step is the default and
  right for independent multi-feature work; consolidation via
  `**Plan-review checkpoint**` / `**Code review checkpoint**` markers
  is appropriate for single-deliverable tasks where the steps are
  mechanical applications of one design. TP-186 is referenced as the
  canonical consolidation example.

### Internal

- **`DEFAULT_WORKER_USER_TOOLS` migrated to a shared lightweight
  constants module (TP-189-B / TP-184 follow-up):** the literal
  `"read,write,edit,bash,grep,find,ls"` was duplicated across
  `extensions/taskplane/agent-host.ts` (canonical), `config-schema.ts`
  (×2), and `types.ts` (×1), with `NOTE (TP-184)` comments pointing at
  the canonical source. The duplication existed because `agent-host.ts`
  imports `child_process`/`fs`, and pulling those into the schema/types
  layer would either be circular (types.ts is the import root for
  agent-host.ts) or pollute pure-data files with subprocess plumbing.
  Sage flagged this as a future cleanup target. Fix: new
  `extensions/taskplane/tool-allowlist-constants.ts` is a deliberately
  import-free leaf module that owns the literal. `agent-host.ts` now
  re-exports `DEFAULT_WORKER_USER_TOOLS` from the new module so
  existing internal callers (`execution.ts`,
  `worker-tools-allowlist.test.ts`) continue to work unchanged.
  `config-schema.ts` and `types.ts` now import directly from the new
  module. Verified no circular imports via a Node import probe; existing
  16-test `worker-tools-allowlist.test.ts` suite still passes (constant
  value is unchanged, only its source module moved). `ENGINE_BRIDGE_TOOLS`
  and `buildWorkerToolsAllowlist()` deliberately stay in `agent-host.ts`
  — they have no duplication problem and live next to their consumers.
- **Architectural regression guard for the worker tool allowlist
  spawn-site wiring (TP-189-A1 / TP-184 follow-up):** new
  `extensions/tests/lane-runner-spawn-wiring.test.ts` (4 source-pattern
  tests) asserts that `lane-runner.ts` imports `buildWorkerToolsAllowlist`
  from `agent-host` and calls it as
  `tools: buildWorkerToolsAllowlist(config.workerTools)` at the worker
  spawn site, with explicit guards against passing `config.workerTools`
  directly (which would silently drop engine bridge tools and
  re-introduce issue #530). The call site is also bounded to within
  ~80 lines of the surrounding `agentId:` field, sanity-checking the
  call lives inside the AgentHostOptions object literal.
- **Runtime test of the `review_step` death-spiral guard's REFUSED path
  (TP-189-A2 / TP-186 follow-up):** new
  `extensions/tests/review-step-guard-runtime.test.ts` (5 tests)
  exercises the actual `review_step` tool handler end-to-end via the
  bridge-extension's tool registration. Confirms `type='code'` (and
  `type='test'`) on a step marked `**Status:** ✅ Complete` returns
  the documented REFUSED prose without spawning a reviewer subprocess
  and without incrementing the Review Counter; `type='plan'` is exempt
  even on a Complete step; `type='code'` on an In-Progress step
  proceeds normally. Mocking strategy uses the bare `child_process`
  specifier for portability across Node 22 and Node 24 (matches the
  `windows-worktree-cleanup-fallback.test.ts` rationale).
- **Behavioral tests for `removeWorktree()` Windows MAX_PATH fallback
  (TP-189-A4 / TP-188 follow-up):** new
  `extensions/tests/windows-worktree-cleanup-behavioral.test.ts` (3
  tests) augments the existing source-pattern suite with end-to-end
  decision-branch coverage. Uses a single `child_process` mock that
  dispatches on the spawned command (git vs cmd) plus real on-disk temp
  directories so the post-removal `existsSync` verification passes for
  real. Covers: win32 + "Filename too long" stderr → `cmd /c rd /s /q`
  fallback fires, prune-after-rd ordering verified, removed:true; win32
  + non-MAX_PATH error → fallback skipped, `WORKTREE_REMOVE_FAILED`
  thrown with the original stderr; non-win32 + MAX_PATH text →
  platform guard in `isWindowsMaxPathError` correctly skips the
  fallback.

### Fixed (post-PR-#556 hotfixes)

- **Orchestrator parent crashes on first IPC frame from engine-worker
  (#559):** `ReferenceError: batchState is not defined` thrown from
  `ipcBatchIdMatches` in the supervisor IPC closure crashed the
  orchestrator parent process the moment any engine-worker emitted its
  first `lane-terminated` or `lane-respawned` message. Affected every
  batch — the batch state file was left in `phase=executing` with 0
  progress, and git worktrees / `task/...` branches were orphaned.
  Root cause: TP-187's batchId-gating helper (added to fold sage's
  post-integration finding) referenced `batchState.batchId` 5 times,
  but `batchState` is NOT bound in the supervisor IPC closure — only
  `orchBatchState` and `supervisorState` are. The crash slipped through
  because (1) `node --experimental-strip-types` performs no
  name-resolution checks, only strips type annotations; (2) TP-187's
  in-batch tests mock IPC handlers at a different layer
  (engine-worker → supervisor callbacks via `executeOrchBatch`'s `deps`
  parameter), bypassing the actual extension closure under fault.
  Fix: switched 5 sites from `batchState.batchId` to
  `orchBatchState.batchId` (NOT `supervisorState.batchId` — sage's
  post-mortem on the first attempted fix flagged that
  `supervisorState.batchId` is only populated when the supervisor
  activates, so for batches where the supervisor never activates the
  gate would never fire and the zombie-alert filter would be defeated).
  `orchBatchState.batchId` is the canonical live runtime batch ID for
  the extension closure: declared next to `supervisorState`, populated
  reliably via state-sync IPC. Regression test in
  `extensions/tests/extension-ipc-batchid-scope.test.ts` (4 tests)
  asserts via source-pattern that the supervisor IPC closure region
  contains zero references to `batchState.batchId` and at least one
  reference to `orchBatchState.batchId`. Comments are stripped before
  the check so documentation-of-the-bug doesn't trigger false
  positives.

- **Pi CLI path resolution broken after `@mariozechner` →
  `@earendil-works` rename (#560):** Pi v0.74.0 republished under the
  `@earendil-works` npm scope. Taskplane's Runtime V2 spawn pathway
  resolves Pi's CLI on disk via `path-resolver.ts:resolvePiCliPath()`,
  which hardcoded `@mariozechner` as the only scope to search under
  `npm root -g`. Result: every Runtime V2 spawn (workers, reviewers,
  mergers) failed immediately with `Cannot find Pi CLI entrypoint` on
  any system whose only globally-installed Pi was the new scope.
  Critically, Pi's own extension loader bundles aliases for BOTH
  scopes at runtime (`<pi>/dist/core/extensions/loader.js` lines
  41-45), so all of taskplane's `import type { ExtensionAPI } from
  "@mariozechner/pi-coding-agent"` and `import { Type } from
  "@mariozechner/pi-ai"` sites continue to resolve correctly via Pi's
  in-process aliasing — the rename only breaks **disk-side** lookup
  for child-process spawning. Fix is therefore narrowly scoped to
  `path-resolver.ts`: refactored `resolvePiCliPath()` to walk the cross
  product of base directories × scopes, with `@earendil-works` checked
  first and `@mariozechner` second within each base directory.
  Operators with EITHER scope installed get a working Pi resolution;
  operators with BOTH installed (e.g., during a transition window)
  pick up `@earendil-works`. The error message and the
  `worktree.ts` install hint now name both scopes for diagnosability.
  Other ~10 files that reference `@mariozechner` (TypeScript imports,
  test mocks, peerDependencies, docs) deliberately left as-is because
  Pi's bundled-alias handling makes them work at runtime regardless of
  scope, and updating them risks breaking compat for users on Pi
  versions older than v0.74.0 (which don't have the alias map).
  Regression test in
  `extensions/tests/path-resolver-pi-scope.test.ts` (4 tests) sets up
  temp directories with each scope combination and asserts the
  resolver behaves correctly via real `child_process` probes.

## [0.28.8] - 2026-05-07

### Enhanced

- **Dashboard: task title row widened to span cols 3–6 (#485 follow-up):**
  The task title subtitle introduced in v0.28.7 was constrained to the
  100px-wide task-id column, which truncated most realistic titles
  ('Reviewer runs typec...') after just a few words. Restructured the
  task-row grid to two rows: row 1 holds the primary cells (icon, actions,
  task-id, status, duration, progress, step+telemetry), row 2 holds the
  optional task-title-subtitle spanning cols 3–6 (~486px combined width
  vs. the previous 100px). Stops before col 7 (task-step + telemetry) so
  step info and worker stats stay visible alongside the title. Auto row 2
  collapses to 0 height when no subtitle exists, so tasks with null
  taskTitle look identical to the v0.28.7 single-line layout. Display-only
  change — cannot affect orchestrator correctness.

### Fixed

- **Code reviewer now runs project quality checks (typecheck/lint/format)
  before deciding (TP-188, #541):** Previously, the reviewer agent spawned
  via `review_step(type="code")` evaluated changes through behavioural
  inspection only. It did NOT run `npm run typecheck` / `npm run lint` /
  `npm run format:check`, so code with TypeScript strict-mode errors or
  lint failures could receive APPROVE — those issues then surfaced at the
  worker's Testing & Verification step, blocking the entire batch. In one
  observed production batch, a `code` review returned APPROVE for a step
  that subsequently failed `npm run typecheck` with 5 strict-mode errors
  in the test code the reviewer had just signed off on. Cost of catching
  these earlier: one extra typecheck per code review. Cost of NOT
  catching them: the entire investment in the affected step plus all
  dependents. Fix is a prompt-only change to
  `templates/agents/task-reviewer.md`: a new **Quality-check verification**
  section (between How You Work and Verdict Criteria) instructs the
  reviewer to (1) discover commands by reading
  `.pi/taskplane-config.json` `taskRunner.testing.commands` first, then
  fall back to `package.json` `scripts` for `typecheck` / `lint` /
  `format:check`; (2) run any matching commands using its existing `bash`
  tool (no allowlist change required — `bash` is already in the default
  reviewer tool list); (3) surface failures as **Issues Found** with
  severity `important`; (4) downgrade an otherwise-APPROVE verdict to
  **REVISE** when any quality check fails. Plan reviews skip the section
  entirely (no code exists yet to typecheck). Skip-silently rule: if
  neither config nor `package.json` yields a relevant command, the
  reviewer notes the skip in the Summary and proceeds normally rather
  than blocking on absent infrastructure. 10 new source-pattern tests in
  `extensions/tests/reviewer-quality-checks.test.ts` lock the section
  shape, the hybrid discovery wording, and the verdict-downgrade rule.
- **Windows worktree cleanup falls back to `cmd rd /s /q` when git hits
  MAX_PATH (TP-188, #543):** On Windows with default
  `core.longpaths = false`, `git worktree remove --force` fails with
  `error: failed to delete '<path>': Filename too long` when the worktree
  contains a deep `node_modules` tree (most non-trivial Node projects).
  Previously the orchestrator surfaced cleanup-incomplete via the
  post-integration banner but didn't recover — the operator had to run
  `cmd /c "rd /s /q <path>"` manually. Observed twice during a single
  recovery flow on the user's Windows machine working with
  emailgistics-astro (700+ npm deps). Fix adds two new exported helpers
  in `extensions/taskplane/worktree.ts`: `isWindowsMaxPathError(stderr)`
  (returns true only on win32 + `/filename too long/i`) and
  `runWindowsCmdRd(absolutePath)` (invokes `execFileSync("cmd", ["/c",
  "rd", "/s", "/q", winPath])` with forward slashes normalized to
  backslashes for native Windows path semantics). The fallback fires
  inside `removeWorktree`'s retry loop when the predicate matches,
  prunes git's bookkeeping on success so post-removal verification
  passes, and falls through to the existing terminal/retry classification
  on failure (with both git's stderr and cmd's stderr enriched into the
  thrown error so operators can diagnose). Other error classes (lock
  errors, permission denied, generic git errors) are unaffected. INFO-level
  logs via `execLog("cleanup", "worktree", ...)` make the rescue path
  visible in operator-facing output. 17 new tests in
  `extensions/tests/windows-worktree-cleanup-fallback.test.ts` cover the
  source-pattern wiring (helpers exist; `removeWorktree` calls them;
  `git worktree prune` runs on fallback success; failure path enriches
  the error), platform guard (returns false on linux/macOS), regex
  case-insensitivity, and `runWindowsCmdRd`'s mocked invocation. Tests
  are platform-agnostic via `child_process` mocking so the suite passes
  on every CI runner.

### Internal

- **CI workflow upgraded to Node 24 LTS:** `.github/workflows/ci.yml` was
  on Node 22; `release.yml` had moved to Node 24 LTS during the v0.28.5
  release work but ci.yml was not aligned. Two motivations converged: the
  Node 22 / Node 24 `mock.module()` semantics divergence caused TP-188's
  `runWindowsCmdRd` unit tests to fail on Node 22 CI while passing locally
  on Node 24 (Node 24 aliases bare `child_process` and `node:child_process`;
  Node 22 treats them as separate modules). Bumping ci.yml to Node 24 fixes
  the test mock portability AND completes TP-189's Cluster D ahead of
  schedule.

## [0.28.7] - 2026-05-07

### Enhanced

- **Dashboard: lane parallelization visible in wave indicator chips (#484):**
  Wave chips at the top of the dashboard now group tasks by lane within each
  wave, joining same-lane tasks with `→` (serial) and different-lane tasks
  with ` | ` (parallel). For example, `W1 [TP-165, TP-166, TP-168, TP-167]`
  now reads `W1 [TP-165 → TP-166 | TP-168 | TP-167]`, immediately revealing
  that TP-165→TP-166 are serialized on lane 1 while TP-168 and TP-167 run in
  parallel on lanes 2 and 3. Within each lane, tasks render in execution
  order (per `lane.taskIds`). Hover tooltip on the chip exposes the
  expanded multi-line lane breakdown. Future waves with no lane assignment
  data fall back to the previous flat comma-separated display — no
  regression for unprovisioned waves.
- **Dashboard: task title under task ID in lane view (#485):** The lane
  view now renders the human-readable task title (extracted from PROMPT.md's
  `# Task: <ID> - <title>` first-line heading) as a smaller muted subtitle
  beneath the task ID. Operator no longer needs to remember what each
  TP-XXX is. The title is read once from PROMPT.md and cached for the
  server's lifetime (PROMPT.md is immutable above the `---` divider).
  Surfaced via a new `taskTitle` field on `/api/state` task records;
  frontend falls back gracefully when the field is null.

## [0.28.6] - 2026-05-06

### Fixed

- **Worker death-spiral when code review returns REVISE on a step already
  marked Complete in STATUS (TP-186, #537, #542):** Previously, if a worker
  set a step's `**Status:** ✅ Complete` heading in STATUS.md before calling
  `review_step(type="code")`, and the reviewer returned `REVISE`, the worker
  was caught in a state contradiction (STATUS says done, reviewer says not)
  with no recovery recipe in the prompt. The worker would loop through 3
  no-progress iterations and the orch's safety mechanism would kill the
  lane — the entire batch was a write-off, requiring ~15 min of manual git
  surgery per occurrence. The fix is structural: (1) the base worker prompt
  (`templates/agents/task-worker.md`) now contains an explicit **Order of
  Operations** rule that mandates code review BEFORE marking a step
  Complete, a **Recovery Recipe** for the case when the rule is
  accidentally violated (revert STATUS → commit → handle REVISE through
  the normal flow), and a **Forbidden** callout naming the death-spiral
  anti-pattern alongside the existing "NEVER add, remove, or renumber
  steps" family of MUST-NOT rules; (2) the engine-side `review_step` tool
  now refuses to run on a step already marked `**Status:** ✅ Complete`,
  returning a `REFUSED` verdict that points the worker at the Recovery
  Recipe (the refusal applies to `code` and `test` review types only — plan
  reviews fire pre-implementation and are correctly exempt). Until this
  fix shipped, Review Level ≥ 2 was effectively unsafe in production. 14
  new tests in `worker-step-completion-protocol.test.ts`. Supersedes the
  partial diagnosis in #510. Thanks to the production batch
  `20260506T105850` against `emailgistics-astro` for surfacing the
  reproducer.

## [0.28.5] - 2026-05-05

### Fixed

- **Pi no longer hard-blocks startup with a red error when run in directories
  that aren't configured for Taskplane (TP-183, #523):** Previously, launching
  pi in any non-git directory (or any directory without
  `.pi/taskplane-workspace.yaml` / `taskplane-config.json`) raised a verbose
  red `WORKSPACE_SETUP_REQUIRED` notification at session_start. For users who
  only want Taskplane in *some* projects, this was wrong UX. The
  orchestrator now soft-fails the `WORKSPACE_SETUP_REQUIRED` case
  specifically: no error notification, status line shows the quiet
  `🔀 Orchestrator · disabled (no taskplane config in workspace)` indicator,
  orchestrator commands stay gracefully disabled (and still explain why if
  invoked, via the existing `requireExecCtx` guard). Configuration errors in
  workspaces that ARE set up — `WORKSPACE_FILE_PARSE_ERROR`,
  `WORKSPACE_SCHEMA_INVALID`, `WORKSPACE_REPO_PATH_NOT_FOUND`, and every
  other `WorkspaceConfigErrorCode` — still surface loudly with the existing
  red notify and `❌ startup failed (workspace config error)` status line, so
  real misconfigurations remain visible. Throw behavior of
  `buildExecutionContext` is unchanged — only the display in `extension.ts`
  changes. 6 new tests in `orchestrator-startup-uxv2.test.ts` (3 scenarios,
  6 fine-grained checks). Thanks to @mwickens for the report.
- **Workers can now invoke `review_step`, `notify_supervisor`,
  `escalate_to_supervisor`, and `request_segment_expansion` (TP-184, #530):**
  Previously these
  engine-internal coordination tools were missing from the worker's
  hardcoded `--tools` allowlist, so pi's tool gate filtered them out at the
  worker. The visible symptom: plan/code/test reviews silently never fired
  at Review Level >= 1, supervisor steering replies were impossible, and
  multi-repo segment-expansion requests were unreachable. The bridge tools
  are now always appended to the worker allowlist regardless of
  `taskRunner.worker.tools` config; the user-tools default is unchanged.
  Introduces three new exports in `agent-host.ts`: `ENGINE_BRIDGE_TOOLS`
  (canonical list of engine-internal tools), `DEFAULT_WORKER_USER_TOOLS`
  (the user-tools default literal), and `buildWorkerToolsAllowlist()`
  (combines user portion with bridge tools, deduplicated). Called exactly
  once at the lane-runner spawn site. Defense-in-depth: lane-runner now
  warns (via `logExecution`) if any bridge tool is missing from the final
  allowlist. 14 new tests in `worker-tools-allowlist.test.ts`.
- **Preflight `pi` check no longer misreports cold-start timeouts as "Pi not
  found" (TP-185):** `execCheck` now classifies failures by mode (`not-found`,
  `timeout`, `exit-code`, `signal`, `unknown`) instead of treating every
  failure as missing-binary. The `pi` preflight now uses a 30s timeout (up
  from 10s) and retries once on timeout to absorb cold-start variance — mise
  shim resolution, Node bootstrap, AV process-launch scanning, and pi's own
  startup can together exceed 10s on a fresh first run, especially on Windows.
  Failure messages and hints are now tailored to the actual error kind
  (e.g. timeouts say "Pi did not respond within 30s" + diagnostic guidance,
  rather than the misleading "Install pi" hint). Detects missing binaries on
  both POSIX (ENOENT/exit 127) and Windows (`cmd.exe` "is not recognized")
  shells. 9 new tests in `exec-check-error-classification.test.ts` covering
  every classification path including regression guards against the original
  bug. Backward compatible: existing callers reading `{ ok, stdout }` are
  unaffected.
- **Worker model/thinking/tools from preferences now flow through to spawned
  workers (TP-181, #522):** `taskRunner.worker.{model,thinking,tools}` in
  `preferences.json` (and project config) are now threaded from
  `TaskRunnerConfig` through `executeWave` → `executeLaneV2` to the worker
  subprocess via `TASKPLANE_WORKER_{MODEL,THINKING,TOOLS}` env vars. Previously
  `LaneRunnerConfig.workerModel` was hardcoded to `""` and the user-configured
  worker model was silently ignored. Mirrors the existing reviewer pipeline
  established in TP-160. New `buildWorkerEnv()` helper, plumbed through
  `engine.ts`, `execution.ts`, and `resume.ts`. 11 new tests in
  `worker-model.test.ts`. Thanks to @NerfEko.

## [0.28.4] - 2026-04-20

### Fixed

- **Settings TUI: Agent Extensions description:** Shows "Toggle extensions per
  agent type" instead of generic "Read-only collection/record fields" label.

## [0.28.3] - 2026-04-20

### New

- **Forward project and global extensions to spawned agents (#511, #513):**
  Third-party pi extensions installed via `.pi/settings.json` (project-level or
  global) are now forwarded to worker, reviewer, and merge agents as explicit
  `-e` flags. Previously, `--no-extensions` blocked all auto-discovered packages
  from loading in spawned subprocesses.
  - New `settings-loader.ts` reads and merges packages from project and global
    settings files, deduplicates, and filters out taskplane itself.
  - Per-agent-type exclusions via `excludeExtensions` config arrays on
    `taskRunner.worker`, `taskRunner.reviewer`, and `orchestrator.merge`.
  - New **Agent Extensions** submenu in `/taskplane-settings` TUI — toggle
    extensions on/off per agent type with auto-discovered package list.
  - All three spawn points wired: worker (lane-runner), reviewer
    (agent-bridge-extension), merge agent (merge.ts).
  - Exclusions threaded through engine retry paths (crash retry, model
    fallback, stale worktree recovery) and resume flows.
  - 27 new tests covering settings loading, exclusion filtering, and
    spawn arg injection.

### Fixed

- **Taskplane exclusion filter tightened:** Extension filter now uses exact
  package name matching instead of substring. Packages like `npm:taskplane-utils`
  are no longer incorrectly filtered out.

### Docs

- Added hybrid IPC architecture specification (`docs/specifications/taskplane/`).
- Updated `docs/how-to/configure-task-runner.md` with `excludeExtensions` config.

## [0.28.2] - 2026-04-14

### Fixed

- **Dashboard: split `useV2` into `useV2Progress`/`useV2Step`:** Fixes edge
  case where step label and progress bar could reference stale data from
  different render cycles.
- **Dashboard: segmented bar isDone excludes merge phase:** Progress bar no
  longer shows "complete" prematurely during wave merging.
- **Dashboard: running task with 0 total shows "executing...":** Instead of
  displaying 0/0 (0%), shows a descriptive status while checkboxes are being
  discovered.
- **`buildCiDeps` accepts `stateRoot` param:** Fixes workspace-mode path
  resolution for CI dependency checking during PR lifecycle.

## [0.28.1] - 2026-04-13

### Fixed

- **Dashboard: stale STATUS.md viewer across batches (#487):** Viewer clears
  when a new batch starts instead of showing previous batch's content.
- **Dashboard: lane step label never updates (#488):** Step name re-read from
  sidecar on every poll instead of caching the initial value.
- **Dashboard: succeeded tasks show 0% progress (#491):** Override to 100%
  and "Complete" when task status is succeeded.
- **Dashboard: wave indicators flash green during merge (#493):** Only
  completed waves show green during merge phase; merging wave shows pulse.
- **Dashboard: no progress for non-final segments (#494):** Segment-scoped
  progress displayed during execution.
- **Dashboard: merge telemetry duplicated across waves (#498):** Merge agent
  telemetry associated with correct wave via waveIndex.
- **Dashboard: supervisor actions lack descriptions (#497):** Context/detail
  fields from JSONL now displayed in recovery actions table.
- **orch-integrate doesn't set integratedAt (#499):** Integration timestamp
  written to batch history before cleanup. Dashboard correctly transitions
  completed batches to history view in workspace mode.
- **Dependency parser: **Task:** format (#486):** Parser now matches both
  `**Requires:**` and `**Task:**` label formats from the skill template.

## [0.28.0] - 2026-04-13

### New

- **Phase A: Segment-aware steps (TP-173, TP-174, TP-175, TP-176, TP-177):**
  Multi-repo polyrepo tasks now support `#### Segment: <repoId>` markers in
  PROMPT.md steps. Workers only see checkboxes for their current segment.
  - Discovery parser extracts step-segment mappings from PROMPT.md
  - Lane-runner filters iteration prompt, progress tracking, and stall
    detection to the current segment's checkboxes
  - Workers exit cleanly when their segment's checkboxes are complete
  - Dashboard shows segment-scoped progress bars and STATUS.md viewer
  - create-taskplane-task skill generates segment markers for multi-repo tasks
  - Worker prompt template updated with multi-segment guidance
  - Single-segment tasks completely unaffected (backward compatible)

- **Hard mode separation for worker prompts:** Two separate prompt files
  (`task-worker.md` for full-task, `task-worker-segment.md` for segment-scoped)
  instead of conditional prose in one prompt. In FULL_TASK mode, all segment
  signals are stripped: no segment env vars, no segment ID in prompt, no
  segment tools. Workers cannot self-scope on signals that don't exist.

### Fixed

- **Monitor STATUS.md path resolution (#501):** Monitor poll was re-resolving
  STATUS.md path with `isWorkspaceMode=false`, reading stale files from the
  main checkout instead of the worktree. Added `parseStatusMdAtPath()` that
  reads directly from the authoritative path. Fixes 0% progress display for
  all workspace-mode tasks.

- **Worker self-scoping in workspace mode:** Workers exited after one step
  because: (a) multi-segment rules applied to all tasks, (b) segment ID
  metadata triggered self-scoping behavior, (c) discovery fallback created
  stepSegmentMap entries without explicit markers. Fixed by hard mode
  separation and `hasExplicitMarkers` gate.

- **Segment env var inheritance:** `TASKPLANE_ACTIVE_SEGMENT_ID` and
  `TASKPLANE_SEGMENT_ID` hard-cleared to empty string in FULL_TASK mode
  to prevent parent process env inheritance from leaking segment cues.

### Docs

- Segment-aware steps specification updated to v4 (Phase A fully specified,
  Phases B-F strategy outlined with Sage architectural review findings)

## [0.27.0] - 2026-04-12

### Breaking

- Worker prompt rewritten: workers must not exit voluntarily between steps.
  Workers that previously exited after partial progress may now behave
  differently (they keep working instead of stopping).

### New

- **Supervisor-in-the-loop exit interception (TP-172):** When a worker exits
  without progress, the lane-runner holds the session alive and escalates to
  the supervisor. The supervisor can send targeted instructions to continue
  the worker's session with full conversation context preserved.
- **Soft progress detection:** Stall detector checks `git diff` for uncommitted
  source changes before counting an iteration as stalled. Workers editing code
  but not yet checking boxes get credit for progress.
- **Corrective re-spawn prompt:** When a worker is re-spawned after no-progress
  exit, the iteration prompt explicitly warns about the previous failure pattern
  and demands action.
- **Worker exit contract:** Worker prompt rewritten with "Do NOT Exit — Keep
  Working Until Done" and "Never Narrate What You Plan To Do" sections,
  addressing the #1 failure mode of workers saying "Now let me fix this:" and
  then stopping.

### Fixed

- **Segment .DONE guard (TP-165, #457):** `.DONE` is no longer created after
  the first segment of a multi-segment task. The lane-runner checks for pending
  expansion requests in the worker outbox before creating `.DONE`.
- **Expansion consumption (TP-165, #452):** Engine correctly resolves worker
  agent IDs for outbox lookup in workspace mode. `.DONE` removal path now uses
  `resolveCanonicalTaskPaths` with worktree-relative paths.
- **Wave planner phantom waves (TP-166, #454):** Wave count matches the actual
  dependency graph depth. Operator-facing displays use `taskLevelWaveCount`.
- **Global lane cap (TP-166, #451):** `enforceGlobalLaneCap` is wired into the
  workspace execution path. `maxLanes` is now a global cap, not per-repo.
- **Init Windows backslash (TP-167, #446):** `taskplane init` normalizes all
  paths to forward slashes before writing to YAML and JSON config files.
- **Artifact cleanup (TP-168, #296):** Telemetry age sweep reduced from 7 to 3
  days. Verification, conversation, and lane-state files included in sweep.
  Telemetry directory size cap (500MB) with oldest-first eviction.
- **Resume crash after expansion (TP-169, #441):** `taskFolder` populated for
  dynamically-added segments during resume reconstruction.
- **Workspace orch branch (TP-169, #458):** All workspace repos get an orch
  branch at batch start. Missing branch on resume is now fatal (throws) instead
  of warning-and-continue.
- **CLI widget session-dead (TP-170, #425):** Widget is wave-aware — completed
  lanes from prior waves show succeeded, active lanes show progress. Session
  name reconciliation fixed.
- **Skipped task progress (TP-171, #453):** STATUS.md and worker commits from
  skipped tasks are cherry-picked to the orch branch via isolated worktree.
  `.DONE` excluded from skipped staging.
- **Batch history gap (TP-171, #455):** All wave-planned tasks recorded in
  batch history including skipped, failed, and never-started tasks.
- **Close-directive parser:** Long supervisor instructions (>30 chars) starting
  with "stop" are no longer misinterpreted as close directives.
- **Skipped artifact paths (Sage):** `taskFolder` resolved against lane worktree
  path in workspace mode for correct cross-repo artifact staging.

### Docs

- Segment-aware steps specification (draft v4) for multi-repo task execution
- Supervisor primer: Section 13c for worker exit interception alerts

## [0.26.1] - 2026-04-11

### Fixed

- `orch-integrate` detects already-merged orch branch and runs cleanup only
- Supervisor primer: always call `orch_integrate()` after manual merge
- Dashboard: human-readable labels for supervisor recovery actions
- Broken link to deleted `task-runner.ts` in spec doc

## [0.26.0] - 2026-04-11

### Breaking
- **task-runner.ts deleted** — The original `/task` command extension (2,784 lines) has been removed entirely. `/task`, `/task-status`, `/task-pause`, and `/task-resume` no longer exist. Use `/orch` for all task execution.

### New
- **`sidecar-telemetry.ts`** — New canonical module for sidecar JSONL tailing utilities (extracted from task-runner.ts).
- **`context-window.ts`** — New canonical module for context window resolution (extracted from task-runner.ts).
- **`loadConfig`, `_resetPointerWarning`** — Moved to `config-loader.ts`.
- **`loadAgentDef`** — Exported from `execution.ts`.

### Fixed / Improved
- **TP-163 (#471):** ENOENT crash when task folders are uncommitted at batch start — orch branch now fast-forwarded after staging commit.
- **TP-164 (#465):** Live merge agent telemetry in dashboard — merge agents show tool calls, cost, context %, elapsed during merge phase.
- **Reviewer model threading (TP-160):** Configured reviewer model/thinking/tools now correctly passed to reviewer subprocess on all execution paths (initial waves, resume, retries).
- **Ghost worker detection (TP-159 #461):** Orphaned workers detected within one poll cycle and marked crashed immediately.
- **Config reload on /orch start (TP-158 #460):** Config changes take effect without restarting pi.
- **Path resolver consolidation (TP-157):** All npm/package path resolution centralized in `path-resolver.ts`, fixing macOS Homebrew/nvm failures.
- **Supervisor hang fix:** `/orch` no longer hangs the terminal on activation.
- **Settings live reload:** `/taskplane-settings` changes apply immediately without restart.

## [0.24.31] - 2026-04-07

### New
- **TP-145: Multi-segment .DONE timing + expansion edge validation** — Four-layer defense against premature .DONE: pre-segment deletion, worker prompt rule, post-segment deletion, expansion deletion. Edge validation accepts anchor-repo references.
- **TP-146: Missing orch branch investigation** — Root cause identified (`resolveBaseBranch` fallback), diagnostic logging added.
- **TP-147: Skipped task branch preservation + batch history completeness** — Partial work saved as `saved/*` refs. All wave plan tasks recorded in history.
- **TP-148: Wave display, global maxLanes cap, session naming** — Dashboard shows segment context in waves. Global lane cap across repos. Lane-number fallback for widget liveness.
- **TP-149: Supervisor integration ordering** — Tries FF first, merge second, PR only when protected + diverged + remotes exist.
- **Local build script** — `node scripts/local-build.mjs` copies dev files to global install for testing without npm publish.

### Fixed
- **Dashboard messages no longer truncated** — Removed 120-char JS truncation, CSS wrapping enabled.
- **Premature .DONE deletion gated on actual insertion** — No-op expansion mutations no longer reopen completed tasks.
- **Batch history deduplication** — Gap-fill loop updates covered set after each push.
- **Integration plan tries FF before PR for protected branches** — Tests updated.
- **maxLanes warning when repos exceed global cap.**
- **resolveBaseBranch log prefix consistency.**

## [0.24.30] - 2026-04-06

### Fixed
- **Segment expansion requests not consumed by engine** (#452) — Post-wave processing used stale `task.activeSegmentId` (already null for completed single-segment tasks). Now uses `outcome.segmentId` from task outcome. Same fix applied to failed task path.
- **Workspace config resolution short-circuit** (#424) — `hasConfigFiles()` no longer counts `taskplane-workspace.yaml` as a project config file.
- **Workspace init doubled config repo name** — Tasks directory path no longer doubled when config repo prefix matches.
- **`taskplane init` writes `task_packet_repo`** — Eliminates compatibility warnings on workspace startup.
- **Windows backslashes in init paths** (#446) — All path inputs normalized to forward slashes.

## [0.24.29] - 2026-04-06

### Fixed
- **Workspace config resolution short-circuit** (#424) — `hasConfigFiles()` counted `taskplane-workspace.yaml` as a project config, causing the pointer-resolved config root to be skipped. Task areas were empty, discovery found no tasks. Fix: workspace YAML excluded from config file detection.

## [0.24.28] - 2026-04-06

### Fixed
- **Workspace init doubled config repo name in tasks directory** — `shared-libs/shared-libs/task-management/...` now correctly resolves to `shared-libs/task-management/...`.

## [0.24.27] - 2026-04-06

### Fixed
- **`taskplane init` writes `task_packet_repo` in workspace YAML** — Eliminates compatibility warnings on workspace startup.

## [0.24.26] - 2026-04-06

### Fixed
- **Windows backslashes in `taskplane init` paths** (#446) — All path inputs normalized to forward slashes before writing to YAML/JSON config. Fixes YAML parse error on Windows.

## [0.24.25] - 2026-04-06

### New
- **Safety-net auto-commit for uncommitted worker artifacts** — Before the merge phase, each merge-candidate lane worktree is checked for uncommitted changes. If found, auto-committed with a safety-net message. Prevents permanent loss of worker-created files when workers forget to commit.

### Fixed
- **Sage review remediations for segment expansion** — merge.ts taskFolder guard (#441), resume segments carry-forward, segment metadata rehydration, topo-sort failure rollback, requestedRepoIds uniqueness validation.

## [0.24.24] - 2026-04-06

### Fixed
- **Merge agent auth failure** — v0.24.21's `PI_CODING_AGENT_DIR` isolation cut off API credentials (`auth.json` was empty in the isolated dir). Merge agents silently failed to authenticate, producing zero tool calls. Removed process-level isolation; test-level isolation in `project-config-loader.test.ts` is sufficient.

## [0.24.23] - 2026-04-06

### New
- **TP-142: Segment expansion tool + file IPC** — `request_segment_expansion` RPC tool for workers to request new segments at runtime. SegmentId extended with sequence suffix (`::2`) for repeat-repo segments. Non-autonomous guard rejects in supervised/interactive mode.
- **TP-143: Engine segment graph mutation** — Engine consumes expansion requests at segment boundaries. DAG mutation with formal successor rewiring (roots/sinks algorithm). Repeat-repo segments, cycle detection, idempotency guard. Persisted to batch state for resume.
- **TP-144: Segment expansion acceptance tests** — Unit test coverage for expansion tool, engine mutation, frontier reconstruction, and resume. Live e2e deferred due to merge thinking issue.

### Fixed
- **Resume crash after segment expansion** (#441) — `resolve(allocTask.task.taskFolder)` guarded for missing/empty taskFolder. Persisted segments carried forward on resume. Segment metadata (segmentIds, activeSegmentId, packetRepoId, packetTaskPath) rehydrated into discovered tasks.
- **Topo-sort failure rejects expansion** — Was falling back to append-order which could violate dependency semantics. Now fully rolls back to pre-mutation state.
- **Engine-side requestedRepoIds uniqueness** — Duplicate repo IDs in expansion request now rejected at engine validation.

## [0.24.22] - 2026-04-05

### New
- **TP-140: Global preferences architecture** — Config precedence flipped: schema → global prefs → project overrides. "User preferences" renamed to "global preferences" throughout. Project config is sparse (only overrides). Settings TUI defaults to saving to global. Source badges: `(global)` and `(project)`.
- **TP-141: First-install bootstrap + cross-provider guidance** — Global prefs bootstrapped from schema defaults on first install. Thinking defaults to `high` for worker/reviewer. First `taskplane init` guides cross-provider reviewer/merger model selection. Thinking picker shows all pi levels (off through xhigh).

### Fixed
- **Merge agent thinking defaults to `off`** (#439) — Thinking caused merge agent to spend 70 min reasoning without calling any tools. Merge is mechanical; thinking is counterproductive.
- **Deprecated `/task` commands removed** — `/task`, `/task-status`, `/task-pause`, `/task-resume` no longer registered. `/orch` is the only execution path. Spawn Mode setting removed from TUI.

## [0.24.21] - 2026-04-05

### Fixed
- **Test and merge agent isolation from user preferences** — `project-config-loader.test.ts` isolates `PI_CODING_AGENT_DIR` per test. Merge agent spawns with isolated agent dir. Prevents stale user prefs from contaminating verification tests.
- **Enum settings use picker instead of toggle** — Integration and Autonomy Level now open a scrollable picker on Enter (was unintuitive ←/→ cycling).

## [0.24.20] - 2026-04-05

### New
- **TP-138: Inherit defaults + thinking picker** — Worker thinking and reviewer model now default to inherit (empty string). "inherit" string alias normalized to empty. Thinking picker (inherit/on/off) in `/taskplane-settings` with model-change suggestion. Runtime fallbacks audited — no `--thinking`/`--model` flag passed when empty.
- **TP-139: Init model picker + global defaults** — Interactive provider → model → thinking selection during `taskplane init`. `taskplane config --save-as-defaults` saves agent settings to user preferences for future inits. Model registry queried via `pi --list-models`.

### Fixed
- `generateProjectConfig()` in CLI now uses inherit defaults (was hardcoding `worker.thinking: "off"` and `reviewer.model: "openai/gpt-5.3-codex"`).
- `qualityGate.reviewModel` now normalized — `"inherit"` no longer passed as literal `--model inherit`.
- `sanitizeInitAgentConfig` normalizes `"inherit"` in model fields from saved preferences.

## [0.24.19] - 2026-04-05

### Fixed
- **Merge thinking user prefs silently dropped** — `mergeThinking` was referenced in settings TUI but not wired through `UserPreferences` interface, extraction, or application. Saving merge thinking to user prefs was a no-op.

## [0.24.18] - 2026-04-04

### New
- **Merge agent thinking config** — `MergeConfig` now has a `thinking` field (empty = inherit session). Available in `/taskplane-settings` under Merge section.

## [0.24.17] - 2026-04-04

### New
- **Interactive model picker in `/taskplane-settings`** — Model selection now uses a two-level provider → model picker instead of free-text input. First option is "inherit (use current session model)". Current model marked with ✓. Falls back to manual input if no models available.

## [0.24.16] - 2026-04-04

### Fixed
- **Batch history persistence (TP-137)** — Batch history now survives `orch_integrate`. The parent process writes history after engine completion, and integration preserves `.pi/batch-history.json` across merges. Fixes #423.

## [0.24.15] - 2026-04-04

### Fixed
- **Wave transition false-failure from stale lane snapshots** — Stale lane snapshot files from prior waves are now cleared before launching new wave workers. Added 60-second tracker-age grace period so newly-started tasks aren't marked failed during worker startup. Fixes TP-005 being falsely marked failed at wave 2 start in workspace mode.

## [0.24.14] - 2026-04-04

### Fixed
- **Same-repo segment packet paths resolve inside worktree** — When packet home repo equals execution repo, packet paths now resolve inside the worktree instead of using absolute paths to the original repo. Fixes `.DONE` being written outside the worktree (monitor couldn't find it → false task failure while worker completed successfully).

## [0.24.13] - 2026-04-04

### Fixed
- **Missing `runGit` import in waves.ts** — `resolveBaseBranch` called `runGit()` but `waves.ts` only imported `getCurrentBranch` from `git.ts`. In the jiti-compiled engine-worker context, this threw `ReferenceError: runGit is not defined`, silently falling back to the repo HEAD branch. Root cause of persistent wave 2 worktree base branch failures.

## [0.24.12] - 2026-04-04

### Fixed
- **Wave 2+ worktree base branch (v0.24.10 regression)** — The orch branch existence check used `check.status` instead of `check.ok` (`runGit` returns `{ ok }` not `{ status }`). The check always failed, so worktrees were still branched from develop instead of the orch branch.

## [0.24.11] - 2026-04-04

### Fixed
- **Merge result path on Windows** — Normalize backslash paths to forward slashes in merge request text. Prevents LLM from converting to MSYS-style `/c/dev/...` which Node.js misresolves to `C:\c\dev\...` on Windows.

## [0.24.10] - 2026-04-04

### Fixed
- **Workspace wave 2+ worktree base branch** — Worktrees now branch from the orch branch (which has prior wave merged work) instead of the repo's HEAD. Fixes wave 2 workers not finding wave 1 artifacts in polyrepo mode.

## [0.24.9] - 2026-04-03

### Fixed
- **Cross-repo segment execution: packet path resolution** — `packetTaskPath` is now resolved to an absolute path using the workspace root. Previously stored as a relative path, which broke when a segment executed in a different repo's worktree (lane-runner couldn't find PROMPT.md/STATUS.md/.DONE to create completion markers). First polyrepo segment test surfaced this.

## [0.24.8] - 2026-04-03

### New
- **Multi-repo segment execution MVP (TP-132–136)** — Full segment-based execution for workspace/polyrepo mode:
  - **TP-132:** Spec aligned to Runtime V2 contracts
  - **TP-133:** Engine segment frontier — consumes segment plans, executes segments sequentially per-task, packet-home `.DONE` authority
  - **TP-134:** Segment-aware lane execution — segmentId in snapshots/outcomes, separate execution cwd from packet paths, segment context in worker prompts
  - **TP-135:** Segment persistence + resume — `segments[]` populated in batch state, resume reconstructs segment frontier from persisted state
  - **TP-136:** Segment observability — dashboard shows active segment per lane, supervisor alerts include segment context

### Fixed
- **Supervisor alert on engine crash** — Error IPC handler now emits `onSupervisorAlert` (was only calling `ctx.ui.notify`). The supervisor is now notified of engine crashes.
- **Disk persistence on engine crash** — Parent process persists `batch-state.json` with `phase: "failed"` when engine crashes. Fixes #421.

## [0.24.7] - 2026-04-03

### Fixed
- **Crash fix: onTelemetry guard** — The `onTelemetry` call added in v0.24.6 for immediate context % refresh was missing the optional callback guard. Crashed the engine when `spawnAgent` was called without `onTelemetry` (merge agent, reviewer). First real-world validation of TP-130’s `uncaughtException` diagnostic pipeline.

## [0.24.6] - 2026-04-03

### New
- **Live context % refresh (TP-129)** — `get_session_stats` requested periodically (every 5 assistant messages) instead of one-shot. Context % emitted immediately on `response` event for true live dashboard updates.
- **Engine worker diagnostics (TP-130)** — `uncaughtException`/`unhandledRejection` handlers send stack trace via IPC before exit. Stderr captured to `.pi/telemetry/{batchId}-engine-worker-stderr.log` with tail included in supervisor alerts. Snapshot failure counter auto-disables reviewer refresh after 5 consecutive failures.
- **TMUX naming cleanup (TP-131)** — Dashboard `tmuxSessions` → `sessions`, `.tmux-*` CSS → `.session-*`, server stubs cleaned, `/api/pane/*` removed, audit expanded to `skills/`.
- **Reviewer telemetry parity** — Dashboard reviewer sub-row shows elapsed, tools, context %, token summary, and last tool (matching worker badges).

### Fixed
- **Duplicate crash alerts suppressed** — When engine-worker sends error via IPC before exiting, the parent no longer fires a second alert on the exit event.
- **Stderr capture flush safety** — Stream flushed before log rotation, error handler added, in-memory tail preferred over disk file for freshest data.
- **Dashboard version skew** — Frontend reads `sessions ?? tmuxSessions` for backward compat.

## [0.24.5] - 2026-04-03

### Fixed
- **Checkbox discipline reinforcement** — RULE #1 added to top of worker template: check off each checkbox immediately after completing it, not at step end. Also added explicit reminder in the lane-runner worker prompt.
- **Stall timeout: 30 → 60 minutes** — Prevents false stall kills during long steps where STATUS.md isn't updated until step completion.

## [0.24.4] - 2026-04-03

### New
- **Full-package TMUX extrication (TP-128)** — Removed TMUX from task-runner.ts (-1755 lines), CLI doctor/install checks (-295 lines), supervisor templates, and expanded audit script scope. 15 reviews. Net -5876 lines across 35 files.

## [0.24.3] - 2026-04-03

### Fixed
- **Engine crash prevention** — `emitSnapshot()` is now non-throwing by contract. The `reviewerRefresh` interval and `onTelemetry` callbacks are wrapped in try/catch. Prevents `uncaughtException` → `process.exit(1)` from file I/O errors in telemetry paths. Root cause of engine-worker crashes during long-running batches.

### Changed
- **Worker timeout default: 30 → 120 minutes** — Persistent worker sessions handle multiple steps; 30 min was from the legacy single-step TMUX era.
- **Context window: auto-detect from model** — Default `workerContextWindow: 0` means inherit from the model's context window size. The previous hardcoded 200K was a poor fit for models with 1M+ context.

## [0.24.2] - 2026-04-03

### New
- **Reviewer dashboard visibility (TP-121)** — Reviewer sub-row appears in the dashboard during reviews, showing live telemetry (elapsed, tools, context%, cost, last tool). Bridge extension writes `.reviewer-state.json`, lane-runner reads it into lane snapshot. Includes review type and step number labels.
- **TMUX extrication tasks (TP-122–126)** — Reference baseline/guardrails, operator messaging de-TMUX, comment/type doc sweep, centralized legacy compat shim, final compat removal.
- **TP-127: Wave transition fix** — Monitor no longer reports tasks as "failed" during multi-wave batch transitions (stale snapshot detection + 30s registry fallback).

## [0.24.1] - 2026-04-02

### Fixed
- **Config auto-migration** — Legacy `tmuxPrefix` and `spawnMode: "tmux"` fields are now silently migrated to `sessionPrefix` / `"subprocess"` instead of crashing. Config files updated on disk atomically (tmp+rename). Users updating from pre-v0.24.0 no longer hit a startup crash.
- **Wave transition stale snapshot** (TP-127) — Monitor no longer reports tasks as "failed" during multi-wave batch transitions. Stale snapshot from previous task detected via taskId mismatch, with 30s timeout fallback to registry check.
- **Dead TMUX functions removed** — `buildLaneEnvVars`, `pollUntilTaskComplete`, `resolveRpcWrapperPath`, `generateTelemetryPaths` removed from execution.ts (-459 lines).

## [0.24.0] - 2026-04-02

### New
- **TMUX extrication complete (orch runtime)** — 9 tasks (TP-117–126) removed all functional TMUX code from the orchestrator runtime. 427 → 80 references (81% reduction). Remaining refs are migration compat, error guards, and comments.
- **`review_step` tool for V2 workers** (v0.23.15) — Workers spawn reviewer agents at step boundaries via bridge extension.
- **Worker system prompt fix** (v0.23.14) — Workers receive full 362-line base template with checkpoint discipline.
- **Outcome-embedded telemetry** (TP-116) — Telemetry in LaneTaskOutcome, no fragile key matching.
- **Dashboard batch transition** (v0.23.12) — No page reload when new batch starts.
- **Review level scoring reinforcement** (v0.23.16) — Task creation skill warns against defaulting to Level 0.

### Fixed
- **Batch history token zeros** — Multiple fixes for V2 telemetry pipeline (v0.23.1–0.23.11).
- **Monitor startup race** (v0.23.4) — Assume alive before first snapshot.
- **Agent ID naming** (v0.23.3) — Registry keys aligned with monitor lookups.
- **Dashboard V2 native** (v0.23.2) — Server reads V2 snapshots without legacy shim.
- **jiti cache** (v0.23.8) — Engine-worker purges stale jiti cache on fork.

### Breaking
- **Config rename:** `tmux_prefix` → `sessionPrefix`, `spawn_mode: "tmux"` → throws error. Old field names in project config cause hard failures with migration guidance.
- **`tmuxSessionName`** → `laneSessionId` in persisted state. Old field read via backward-compat shim (`tmux-compat.ts`).

## [0.23.16] - 2026-04-02

### Docs
- **Task creation skill: review level reinforcement** — Step 2 now includes inline scoring rubric and explicit warning against defaulting to Level 0. Prompt template adds pre-creation validation reminder.

## [0.23.15] - 2026-04-02

### New
- **V2 `review_step` tool** — Workers can now spawn reviewer agents at step boundaries via the bridge extension. Generates review requests, spawns a reviewer Pi subprocess, waits for completion, and returns APPROVE/REVISE/RETHINK verdict. Works with the Review Level instructions in the base worker template.

## [0.23.14] - 2026-04-02

### Fixed
- **V2 worker system prompt** — Workers now receive the full 362-line base template (`templates/agents/task-worker.md`) composed with project-specific guidance, matching legacy task-runner behavior. Previously V2 workers got a 1-sentence default, causing them to skip checkpoint discipline (no incremental STATUS.md checkbox updates) and ignore review level instructions. Root cause of zero progress visibility during execution.

## [0.23.13] - 2026-04-02

### New
- **Outcome-embedded telemetry (TP-116)** — `LaneTaskOutcome` now carries `laneNumber` and `telemetry` fields populated by the lane-runner at task completion. Batch history reads telemetry directly from outcomes instead of reconstructing it via fragile lane-snapshot key lookups. Legacy snapshot fallback preserved for pre-V2 batches.

## [0.23.12] - 2026-04-01

### Fixed
- **Dashboard batch transition** — When a new batch starts while viewing history, the dashboard now transitions inline instead of calling `location.reload()`. Eliminates the hanging loading indicator in the browser tab.

## [0.23.11] - 2026-04-01

### Fixed
- **Batch history token lookup** — V2 laneTokens now keyed by `lane-N` (from snapshot) and looked up by lane number. Previous approach relied on `batchState.lanes` (undefined) and sessionName (mismatched suffix).

## [0.23.10] - 2026-04-01

### Fixed
- **Batch history token zeros** — `batchState.lanes` was undefined when the batch history writer ran, causing a silent TypeError in the V2 lane snapshot reader. Guarded with `(batchState.lanes || [])`. Dashboard history view now shows real token/cost data.

## [0.23.9] - 2026-04-01

### Fixed
- **Batch history token lookup** — V2 task outcomes have `-worker` suffix on sessionName but laneTokens was keyed without suffix. Now strips suffix as fallback. Dashboard summary page shows real token/cost data.
- **Merge agent "killed" → "exited"** — After successful merge, registry manifest updated to "exited" instead of "killed". Dashboard agents panel shows correct status.
- **jiti cache option** — v0.23.7-8 used wrong option name (`fsCache` instead of `cache`). Now correct.

### Important
- After `npm update`, clear stale jiti cache: `rm -rf "$TEMP/jiti"` then restart Pi.

## [0.23.8] - 2026-04-01

### Fixed
- **jiti cache option name** — v0.23.7 used `fsCache: false` (silently ignored by jiti v2). Correct option is `cache: false`. Stale compiled code at `$TEMP/jiti/` was the root cause of telemetry zeros after npm update.

## [0.23.7] - 2026-04-01

### Fixed
- **jiti cache causing stale engine code** — Disabled filesystem caching in `engine-worker-entry.mjs`. After `npm update`, jiti was serving old compiled code from its cache, causing telemetry zeros and other regressions. Engine-worker now compiles fresh each batch.

## [0.23.6] - 2026-04-01

### Fixed
- **Supervisor summary cost** — The concise batch summary message now reads V2 lane snapshot cost (was bypassing the `collectBatchSummaryData` fix and always showing "not tracked").

## [0.23.5] - 2026-04-01

### Fixed
- **Batch history token counts** — History writer now reads V2 lane snapshots (`.pi/runtime/{batchId}/lanes/*.json`) instead of legacy sidecar files. Token counts and cost are no longer all-zero for V2 batches.
- **Supervisor summary cost** — `collectBatchSummaryData` computes cost from V2 lane snapshots when `diagnostics.batchCost` is zero. Summary now shows real cost instead of "not tracked".

## [0.23.4] - 2026-04-01

### Fixed
- **Monitor startup race** — First monitor poll could fire before lane-runner wrote its initial snapshot, causing the task to be cached as "failed" in `terminalTasks` for the entire execution. Now assumes alive during startup grace window. Root cause of CLI widget showing "✗ failed" despite task succeeding.

## [0.23.3] - 2026-04-01

### Fixed
- **Agent ID naming alignment** — `executeLaneV2()` now uses `resolveOperatorId()` (same as wave planner) instead of hardcoded `"op"` fallback. Fixes monitor always reporting V2 tasks as "failed" due to registry key mismatch.
- **Snapshot-based V2 liveness** — Monitor reads lane snapshot file (`status: "running"`) instead of PID probing for V2 liveness. More resilient, aligns with spec §5.
- **Flaky exitDiagnostic test** — Fixed `Date.now()` drift causing intermittent CI failures.

## [0.23.2] - 2026-04-01

### Fixed
- **Dashboard reads V2 lane snapshots natively** — Server synthesizes `laneStates` from `.pi/runtime/{batchId}/lanes/*.json` directly. No legacy `lane-state-*.json` sidecar files needed for V2 batches. Dashboard and CLI widget now show live worker stats, telemetry, and progress during V2 execution.
- **Removed legacy lane-state shim** — V2 lane-runner writes only to `.pi/runtime/` (no TMUX-era files).

## [0.23.1] - 2026-04-01

### Fixed
- **Lane snapshot telemetry zeros** — Terminal snapshots now populated from `AgentHostResult` with real tokens, cost, tool count, and elapsed time.
- **Dashboard V2 status mapping** — V2 agent status (`exited`/`crashed`/`killed`) mapped to legacy dashboard strings (`done`/`error`) so worker stats render.
- **Batch ID propagation** — V2 lane snapshots include `batchId` so dashboard batch-filtering doesn't drop them.
- **Telemetry snapshot scope** — Reviewer fix for snapshot aggregation correctness.

## [0.23.0] - 2026-03-31

### Breaking
- **Runtime V2 is now the default backend** — All batches (repo mode and workspace mode) use direct process hosting instead of TMUX. TMUX is no longer required for execution correctness. Legacy TMUX paths are retained as fallback only.
- **`/task` fully deprecated** — `/orch` is the single execution path for both single-task and batch execution.
- **Merge strategy changed from squash-first to merge-first** — `mergePr()` in `/orch-integrate --pr` now tries regular merge first (preserves per-commit history), squash as fallback. GitHub repo setting `required_linear_history` must be disabled for merge commits.

### New
- **Runtime V2 architecture** (TP-100–TP-112) — Complete replacement of the TMUX-based control plane:
  - **Direct agent hosting** (TP-104) — `agent-host.ts` spawns `pi --mode rpc` as direct child processes with `shell: false`. Process registry tracks all agents.
  - **Task executor core** (TP-103) — 15 pure functions extracted from `task-runner.ts` into `task-executor-core.ts` for headless execution.
  - **Headless lane-runner** (TP-105) — `lane-runner.ts` manages worker iteration loops, context pressure, stall detection, and `.DONE` creation without TMUX.
  - **Batch execution cutover** (TP-108) — All repo-mode batches use `executeLaneV2`. Merge agents spawn via `spawnMergeAgentV2` (direct agent-host, not TMUX).
  - **Workspace packet-home authority** (TP-109) — Resume checks worktree-relative `.DONE` paths. Workspace mode enabled on V2.
  - **Resume/monitor de-TMUX** (TP-112) — Resume uses process registry for liveness. Monitor uses registry-based agent liveness. Stall kill uses PID SIGTERM. Reconnect follows detect+terminate+rehydrate.
- **Mailbox steering system** (TP-089–TP-092) — File-based cross-agent messaging:
  - `send_agent_message` — Steer running agents via mailbox
  - `read_agent_replies` — Non-consuming, durable outbox history (pending + acked)
  - `broadcast_message` — Send to all agents (all-or-none rate limiting)
  - `notify_supervisor` / `escalate_to_supervisor` — Agent bridge tools
  - Rate limiting: 30s per-agent window with audit events
- **Dashboard Runtime V2** (TP-107, TP-093) — New panels and data sources:
  - **Agents panel** — Registry-backed agent grid with role, status, lane, elapsed
  - **Messages panel** — Event-authoritative mailbox timeline (sent/delivered/replied/rate-limited)
  - **V2 conversation viewer** — Reads normalized agent events instead of TMUX pane capture
  - V2 lane snapshot precedence over legacy lane states
- **Conversation event fidelity** (TP-111) — Agent-host emits `prompt_sent`, `assistant_message`, enriched `tool_call` (with path), and `tool_result` (with summary). All payloads bounded to prevent log growth.
- **Supervisor tools reference** — AGENTS.md now documents all 16 supervisor tools with usage examples.
- **`orch_start` accepts PROMPT.md paths** — `target` parameter now documented to accept single or multiple PROMPT.md paths for targeted execution.

### Fixed
- **Merge V2 liveness** — `waitForMergeResult` is backend-aware: V2 uses process handle liveness, not TMUX session checks.
- **Merge error/retry cleanup** — V2 merge agents killed before respawn to prevent orphans.
- **Abort kills V2 agents** — `killAllMergeAgentsV2()` called alongside TMUX session cleanup.
- **Resume TDZ bug** — `resumeBackend` declaration moved before all uses.
- **Session identity mapping** — V2 `aliveSessions` strips role suffix for reconciliation matching.
- **Dashboard outbox read test** — Made deterministic for same-millisecond writes.
- **`extractAssistantText` null safety** — Handles null/malformed content block arrays without throwing.
- **Tool event payload bounding** — `tool_call` emits bounded `argsPreview` instead of raw args.

### Docs
- **Skill refresh** (TP-101) — `create-taskplane-task` skill updated for `/orch` execution, JSON config precedence, no TMUX, no `PROGRESS.md` requirement.
- **Runtime V2 specs** — 9 architecture documents under `docs/specifications/framework/taskplane-runtime-v2/`.
- **Rollout docs** — Phases F.1–F.3 marked implemented in migration plan.

### Internal
- **Process registry** (TP-104) — `process-registry.ts` with manifest CRUD, registry snapshots, orphan detection.
- **ExecutionUnit + PacketPaths contracts** (TP-102) — Type-safe launch contracts for Runtime V2.
- **Agent bridge extension** — `agent-bridge-extension.ts` for worker→supervisor communication.
- **Test suite growth** — 3406 tests (up from ~3100 at v0.22.18).

## [0.22.15] - 2026-03-30

### Fixed
- **Lane sessions pass `--no-extensions` to pi** — Root cause of telemetry freeze. Pi auto-discovered `task-runner.ts` from the worktree CWD AND loaded it via explicit `-e` flag, resulting in two competing extension copies. The second copy generated timestamp-based sidecar paths, overriding TP-097's stable paths. Also explains worker startup crashes — two copies competing to spawn tmux sessions.

## [0.22.14] - 2026-03-29

### New
- **TP-097: Stable sidecar identity and TMUX lifecycle** — Sidecar path is now deterministic per session (not per spawn attempt), fixing telemetry freeze after crash recovery (#354, root cause of #333/#334). Orphan rpc-wrapper processes cleaned up via PID file on task end (#242). Spawn retry budget increased 2→5 with progressive delay (#335).
- **TP-098: Dashboard duplicate log fix** — Execution log entries no longer render twice (#348). All `.wiggum-wrap-up` legacy references removed (#251).
- **TP-099: Integration STATUS.md preservation** — STATUS.md, .DONE, and .reviews/ files now survive through squash merge integration (#356). Root cause was artifact staging overwriting lane-merged content.

### Fixed
- Artifact staging allowlist expanded to include `.reviews/**` directory tree — review outputs now preserved through merge.
- Worker prompt cleaned of legacy dual wrap-up signal references.
- Wave start message reports post-affinity lane count (#346).

## [0.22.13] - 2026-03-29

### New
- **TP-094: Context pressure fix** — pi sends `contextUsage.percent` but code checked `percentUsed` (always undefined). Context pressure thresholds (85% wrap-up, 95% kill) now work correctly. Manual token-based fallback removed. Context % snapshots written at worker iteration boundaries for post-batch analysis.
- **TP-095: Crash recovery and spawn reliability** — Worker spawn verification with retry after tmux session creation (#335). Lane-state reset on worker restart so dashboard reflects correct state (#333). Telemetry accumulation across worker restarts (#334). Lane session stderr captured to log file for crash diagnosis (#339).
- **TP-096: Dashboard merge telemetry and supervisor tools** — Merge agent telemetry in dashboard with full parity (#328). Four new supervisor recovery tools: `read_agent_status`, `trigger_wrap_up`, `read_lane_logs`, `list_active_agents`.

### Fixed
- **Wave start message reports post-affinity lane count** — previously showed `min(tasks, maxLanes)` ignoring file-scope grouping (#346).

## [0.22.12] - 2026-03-29

### New
- **TP-081: State Schema v4** — persisted-state contracts for segment execution. v1→v2→v3→v4 migration chain, 806 lines of new tests.
- **TP-089: Agent Mailbox** — cross-agent steering protocol. Supervisor can send messages to any running agent (worker, reviewer, merger) via `send_agent_message` tool. rpc-wrapper checks inbox on every turn and injects via pi's `steer` RPC command. Non-blocking, guaranteed delivery. 633 lines of tests.
- **Agent mailbox steering spec** — full protocol design at `docs/specifications/taskplane/agent-mailbox-steering.md`.

### Fixed
- **ORCH_BATCH_ID now reaches lane sessions** — was never populated, causing dashboard batch filtering to fail and stale telemetry to display.
- **Sidecar JSONL ~99% size reduction** — rpc-wrapper now only writes telemetry-relevant events. Merge agents previously produced 42MB+ sidecar files from streaming deltas.
- **REQUEST CHANGES → REVISE verdict mapping** — reviewers using GitHub PR terminology now correctly trigger the REVISE flow.
- **Worker template: plan review before implementation** — explicit CRITICAL section prohibiting implement-then-plan-review sequence.
- **Merger template: use verification commands from merge request** — no longer suggests `npm test` as fallback.

## [0.22.10] - 2026-03-28

### Fixed
- **TP-080 segment inference completeness** — segment planning now accepts workspace repo IDs during wave computation so single-task, cross-repo `File Scope` hints are inferred correctly (e.g., `api/...` + `web/...` now yields two inferred segments instead of collapsing to one when only one repo was present in pending task routing signals).
- **Planning wiring** — `/orch-plan` now passes workspace repo IDs into `computeWaveAssignments(...)` for deterministic, workspace-aware segment inference.
- **Regression coverage** — added tests for workspace-hinted cross-repo inference in `segment-model.test.ts` and `waves-repo-scoped.test.ts`.

## [0.20.0] - 2026-03-26

### New
- **Node.js native test runner (TP-074, TP-075)** — migrated all 2690 tests from vitest to `node:test`. Tests run in **10 seconds** (was 156 seconds with vitest). vitest, vite, and esbuild removed from devDependencies. Custom `expect()` compatibility wrapper preserves assertion syntax.
- **Artifact cleanup and log rotation (TP-065)** — 3-layer defense against unbounded disk growth: post-integrate cleanup, 7-day age-based sweep, 5MB log rotation.
- **Additive upgrade migrations (TP-063, #211)** — `/orch` preflight auto-creates missing scaffold files after `pi update`. No more manual `taskplane init` after upgrades.
- **Dashboard light mode (TP-072)** — sun/moon toggle in header, project-level theme persistence in `.pi/dashboard-preferences.json`.
- **Taskplane logo** — dashboard header now shows the Taskplane word mark.
- **orch_start tool (TP-061, #183)** — supervisor can start batches programmatically.
- **Targeted test execution (TP-060, #200)** — worker template instructs `--changed` tests during steps, full suite only at the gate.

### Fixed
- **Context pressure safety net (#223, TP-066)** — context % calculation now includes cache read tokens. Workers no longer silently exhaust context without wrap-up signals.
- **Persistent reviewer reliability (#225, TP-068)** — early-exit detection, verdict tolerance for non-standard formats, graceful skip on double failure.
- **Merge telemetry in dashboard (#215, TP-067)** — telemetry key derived from lane session naming.
- **Dashboard telemetry crash (#213, TP-064)** — reads capped at 10MB per tick, skip-to-tail on fresh start.
- **Dashboard bug fixes (TP-059)** — merge message shows actual orch branch (#201), merge agents section populates (#202), test failures fixed (#193).
- **STATUS.md step display (#198, TP-062)** — only current step shows "In Progress".
- **Supervisor template pattern (#135, TP-058)** — composable base+local template, same as worker/reviewer/merger.
- **Supervisor event visibility (#214)** — `setStatus` for immediate footer rendering.
- **Worker premature exit** — template instructs always ending with tool call, not text-only response.
- **Worker incomplete exit nudge (TP-073)** — subsequent iterations get explicit nudge listing remaining steps.
- **Stale retrying badge (#189)** — `retryActive` cleared on `message_end`.
- **.DONE checkbox removed** — task-runner creates it automatically, workers no longer checkpoint a redundant item.

### Performance
- **Engine worker thread (TP-071, #199)** — engine runs in a `worker_thread`, supervisor main thread stays responsive.
- **Async I/O (TP-070, #199)** — all polling loops use async I/O, no more `spawnSync("tmux")` blocking the event loop.
- **Test optimization** — `--pool=threads`, integration test separation, barrel import removal.

## [0.19.0] - 2026-03-25

### Fixed
- **Persistent reviewer reliability (#225, TP-068)** — three-layer defense against reviewer model incompatibility:
  1. **Better prompting** — reviewer template explicitly states `wait_for_review` is a registered tool, not a bash command
  2. **Early-exit detection** — if reviewer exits within 30 seconds with no verdict, triggers immediate fallback instead of waiting for 30-minute timeout
  3. **Verdict tolerance** — `extractVerdict` now recognizes non-standard formats ("Changes requested" → REVISE, "Needs revision" → REVISE)
  4. **Graceful skip** — double failure (persistent + fallback) continues task with operator notification instead of blocking

### Changed
- Reviewer template updated with explicit tool usage instructions for persistent mode
- 156 new tests for persistent reviewer reliability scenarios

## [0.18.1] - 2026-03-25

### Fixed
- **Merge agent telemetry in dashboard (#215, TP-067)** — telemetry key now derived from lane session naming pattern, matching actual tmux session names. Dashboard merge section shows token/cost data during merges.

## [0.18.0] - 2026-03-25

### Fixed
- **Context pressure safety net (#223, TP-066)** — context percentage calculation now includes cache read tokens. Previously, workers with heavy cache usage (reading large files) showed artificially low context % and never triggered the 85% wrap-up signal or 95% kill. Workers could silently exhaust their entire context window without any safety net firing.

### New
- **Worker file reading guidance (TP-066)** — worker template now instructs agents to use `grep` + `read` with offset/limit for large files instead of reading entire files. Prevents unnecessary context bloat.
- **246 new context pressure tests** — validates cache-inclusive calculation with threshold triggers.

## [0.17.0] - 2026-03-25

### New
- **Artifact cleanup and log rotation (TP-065)** — 3-layer defense against unbounded disk growth:
  - **Layer 1:** Post-integrate cleanup deletes batch-specific telemetry and merge result files
  - **Layer 2:** Age-based sweep on `/orch` preflight removes artifacts older than 7 days
  - **Layer 3:** Size-capped rotation for `events.jsonl` and `actions.jsonl` at 5MB threshold
  - All cleanup is non-fatal — failures warn and continue

### Fixed
- **Dashboard telemetry crash (#213, TP-064)** — `tailJsonlFile()` capped at 10MB per read tick. Fresh dashboard start on large files skips to tail instead of reading from offset 0. No more `ERR_STRING_TOO_LONG` crashes.

## [0.16.0] - 2026-03-25

### New
- **Additive upgrade migrations (TP-063, #211)** — when users run `/orch` after a `pi update`, newly introduced scaffold files are created automatically. No more manual `taskplane init` after upgrades. Migration state tracked in `.pi/taskplane.json` so each migration runs once per repo. First migration: auto-create missing `.pi/agents/supervisor.md`.

## [0.15.0] - 2026-03-25

### New
- **Targeted test execution (TP-060, #200)** — worker template now instructs targeted tests (`--changed`) during implementation steps and full suite only in the Testing & Verification step. PROMPT template and create-taskplane-task skill updated to reflect the strategy. Reduces test time by ~60% per task.
- **orch_start tool (TP-061, #183)** — supervisor can now start batches programmatically via `orch_start(target)`. Shared helper used by both `/orch` command and tool. Guards prevent starting when a batch is already running.

### Fixed
- **STATUS.md step display (#198)** — only the current step shows "🟨 In Progress". Future steps correctly show "⬜ Not Started" instead of all being marked in-progress.

## [0.14.1] - 2026-03-25

### Fixed
- **Merge message says "into develop" (#201)** — now shows the actual orch branch name.
- **Dashboard merge agents section empty during merge (#202)** — session filter updated to match `orch-{operatorId}-merge-{N}` naming pattern. Telemetry lookups also fixed.
- **Two pre-existing test failures (#193)** — `supervisor-merge-monitoring.test.ts` tests 9.3 and 10.5 updated to match current implementation.

## [0.14.0] - 2026-03-25

### New
- **Supervisor template pattern (TP-058, #135)** — the supervisor agent now follows the same composable template pattern as workers, reviewers, and mergers. Base template (`templates/agents/supervisor.md`) ships with npm and auto-updates. Local override (`.pi/agents/supervisor.md`) enables project-specific customization without editing extension source.
- **Routing template** — `templates/agents/supervisor-routing.md` for onboarding/no-batch mode.
- **Init copies supervisor template** — `taskplane init` now creates `.pi/agents/supervisor.md` alongside other agent templates.

### Changed
- `buildSupervisorSystemPrompt()` and `buildRoutingSystemPrompt()` load templates with `{{placeholder}}` variable injection instead of inline string construction. Falls back to inline prompt when templates are missing.

## [0.13.0] - 2026-03-24

### New
- **Persistent reviewer context (TP-057, #146)** — one reviewer per task instead of per review. The reviewer stays alive across all `review_step` calls via a `wait_for_review` blocking tool, maintaining full context about the task and previous reviews. ~50-60% reduction in reviewer token cost. Falls back to fresh spawn if the persistent reviewer crashes or hits the context limit.
- **New file: `extensions/reviewer-extension.ts`** — registers the `wait_for_review` tool for persistent reviewer mode. Signal protocol uses numbered files (`.review-signal-{NNN}`) for request coordination and `.review-shutdown` for clean exit.

### Changed
- **Reviewer template updated** — supports both persistent mode (with `wait_for_review` tool) and fallback fresh-spawn mode. Cross-step awareness: reviewer references previous findings when reviewing later steps.

## [0.12.0] - 2026-03-24

### New
- **Supervisor merge monitoring (TP-056, #145)** — the supervisor actively monitors merge agent health during the merge phase. Detects dead sessions (tmux died, no result file) within 2-3 minutes instead of waiting for the 90-minute timeout. Escalation tiers: healthy → possibly stalled (10 min) → dead → stuck (20 min). 763 new tests.

### Fixed
- **Stale retrying badge (#189)** — the dashboard telemetry accumulator never cleared `retryActive` when a retry resolved via `message_end`. Stale retry state from previous batches persisted, causing a permanently flashing "retrying" badge. Server-side fix: clear `retryActive` on every successful `message_end`.

## [0.11.0] - 2026-03-24

### New
- **`/task` deprecation (TP-054, #164)** — `/task`, `/task-status`, `/task-pause`, `/task-resume` now show deprecation warnings recommending `/orch`. Commands still work (soft deprecation). Docs updated.
- **Runtime model fallback (TP-055, #134)** — when a configured agent model becomes unavailable mid-batch (rate limit, API key expired, model deprecated), tasks fall back to the session model instead of failing. Configurable via `modelFallback: "inherit"` (default) or `"fail"`. New `model_access_error` exit classification. 509 new tests.

## [0.10.2] - 2026-03-24

### Fixed
- **Dashboard rendering crash** — PR #175 introduced a TDZ (Temporal Dead Zone) crash: `reviewerActive` used before its `const` declaration. Dashboard showed empty lanes section.

## [0.10.1] - 2026-03-24

### Fixed
- **macOS path resolution (#177)** — workers crashed immediately on Homebrew/nvm npm installs because `rpc-wrapper.mjs` and `task-runner.ts` couldn't be found. Resolution now uses `npm root -g` as the primary dynamic lookup, covering all npm setups. Added `/opt/homebrew` static fallback.

## [0.10.0] - 2026-03-24

### New
- **Supervisor orchestrator tools (TP-053)** — the supervisor agent can now invoke `orch_resume`, `orch_integrate`, `orch_pause`, `orch_abort`, and `orch_status` as extension tools. No more asking the user to type slash commands — the supervisor acts autonomously.
- **Shared command/tool helpers** — orchestrator command logic extracted into shared internal functions called by both slash commands and tools. Ensures behavior parity.

### Fixed
- **Retrying badge during reviews (#174)** — dashboard no longer shows a flashing "retrying" badge during `review_step` tool calls.

### Docs
- **execution-model.md** — rewritten for persistent-context + worker-driven inline reviews.
- **review-loop.md** — rewritten for `review_step` tool model.
- **README.md** — updated key features, single-task guidance, architecture description.

## [0.9.3] - 2026-03-24

### Fixed
- **State persistence log spam (issue #166)** — `endTime` for completed/failed tasks was set to `lastPollTime` on every poll tick, causing `changed=true` → persist → log every few seconds. Now freezes once set. Eliminates the `[orch] state/...: persisted: task-transition` flood in the supervisor session.
- **Reviewer sub-row scoped to active task** — reviewer activity row in the dashboard now only appears under the task being reviewed, not under all tasks in the lane.

## [0.9.2] - 2026-03-24

### Fixed
- **Stale branches after integrate (TP-051, issue #142)** — `/orch-integrate` now deletes `task/*` and `saved/task/*` branches from the integrated batch. Also cleans orphaned branches from previous batches. Preserves `orch/*` in PR mode and partial-progress `saved/*` refs.
- **Task startedAt timing (TP-051, issue #19)** — task start times now use actual execution timestamps instead of STATUS.md file mtime. Fixes incorrect timing in dashboard and batch history.

### New
- **Integrate guidance after batch completion (TP-052, issue #99)** — clear, prominent message shows exact `/orch-integrate` and `--pr` commands after every batch completion. Appears in engine output and supervisor routing.
- **Branch protection detection (TP-052, issue #100)** — `/orch-integrate` checks for branch protection via `gh api` before attempting merge. Warns and suggests `--pr` when protection detected. Graceful degradation when `gh` unavailable.
- **Post-batch prompt visibility (TP-052, issue #88)** — supervisor sends a clear conversational message when transitioning to routing mode after batch completion, ensuring the user sees an active input prompt.

## [0.9.1] - 2026-03-24

### Fixed
- **Code review baseline** — `review_step` tool now accepts `baseline` parameter so workers pass the pre-step HEAD SHA. Reviewer sees only the step's changes instead of an empty diff.
- **Reviewer model inheritance** — all reviewer model fallbacks changed from hardcoded `openai/gpt-5.3-codex` to session model inheritance. Config default is now empty (triggers inheritance chain).
- **Dead code removed** — `resolveExtensionPath()` and `isWorkerToolMode()` (19 lines, never called).

## [0.9.0] - 2026-03-24

### New
- **Worker-driven inline reviews (TP-050)** — workers now drive the review process via a `review_step` extension tool, preserving their full context across reviews. Reviewers spawn in named tmux sessions with RPC wrapper telemetry. REVISE feedback is addressed inline by the worker in the same context.
- **Dashboard reviewer sub-row** — live reviewer activity (elapsed, tools, last tool, cost, context%) displayed as a sub-row under the worker row during reviews. Dashboard no longer appears frozen during review phases.
- **Review protocol in worker template** — worker agent template includes review level interpretation (0-3), skip rules for low-risk steps, and verdict handling instructions.

### Changed
- **Review architecture** — reviews moved from outer-loop deferred model (post-worker-exit) to worker-driven inline model (mid-execution via tool call). Review level scoring (0-3) still determines which reviews run.
- **Lane-state sidecar** — extended with reviewer metrics: `reviewerSessionName`, `reviewerType`, `reviewerStep`, `reviewerElapsed`, `reviewerContextPct`, `reviewerLastTool`, `reviewerToolCount`, `reviewerCostUsd`, `reviewerInputTokens`, `reviewerOutputTokens`.

## [0.8.2] - 2026-03-24

### Fixed
- **Telemetry temp file leak** — lane prompt files now written to `.pi/telemetry/` instead of system tmpdir, cleaned up with batch artifacts.
- **Telemetry filename accuracy** — `generateTelemetryPaths()` accepts actual `batchId` and `repoId` instead of hardcoding timestamp and "default". Filenames now correlate correctly across agents in a batch.
- **Shared opId resolution** — extracted `resolveTelemOpId()` helper to prevent divergence between lane and merge telemetry naming.
- **Merge agent crash on fresh projects** — `spawnMergeAgent()` now checks `.pi/agents/task-merger.md` existence before passing `--system-prompt-file`. Falls back gracefully when agent definition is missing.

## [0.8.1] - 2026-03-24

### New
- **RPC telemetry for all orchestrator agents (TP-049, issue #139)** — lane workers, merge agents, and reviewers now spawn through the RPC wrapper during `/orch` batches, producing `.pi/telemetry/*.jsonl` sidecar files and exit summaries. The dashboard consumes these for accurate per-agent tokens, cost, context%, and tool call metrics.

## [0.8.0] - 2026-03-23

### New
- **Persistent worker context (TP-048, issue #140)** — workers now spawn once per task instead of once per step. The worker handles all remaining steps in a single context window, committing at each step boundary. If context runs out mid-task, the next iteration picks up from the last completed step. Typical tasks complete in a single iteration.
- **Context window auto-detect (TP-047, issue #140)** — `worker_context_window` is now auto-detected from pi's model registry instead of hardcoded at 200K. Claude 4.6 Opus correctly uses its 1M context window. Explicit config overrides still take precedence.
- **Updated context defaults** — `warn_percent` raised from 70% to 85%, `kill_percent` from 85% to 95%, maximizing useful context utilization.

### Fixed
- **Model pre-flight display** — worker/reviewer models now read from the full unified config (including user preferences), not the stripped orchestrator config. Previously always showed "inherit" regardless of `/settings`.
- **Dashboard NaN heartbeat (issue #129)** — `relativeTime()` now handles ISO string timestamps from the supervisor lockfile.
- **Lockfile batchId stuck (issue #130)** — heartbeat tick refreshes batchId from live batch state when it was initially "(initializing)".
- **Dashboard shows wrong batch (issue #20)** — after batch completion, dashboard now shows the just-finished batch instead of the previous one. Fixed async race between history fetch and view rendering.
- **Onboarding task area registration (issue #138)** — supervisor onboarding script now explicitly requires registering task areas in config, with example JSON and verification step.
- **Merge timeout default** — increased from 10 to 90 minutes to accommodate large batches with tests.

## [0.7.2] - 2026-03-23

### New
- **Model availability pre-flight check** — `/orch` validates all configured agent models (worker, reviewer, merger, supervisor) against the pi model registry before starting a batch. Misconfigured models block with a clear error instead of failing hours into a run.
- **Unified supervisor mode (issue #128)** — routing-mode supervisor can now start batches via `/orch all`. Batch completion transitions back to conversational mode instead of deactivating. Enables continuous workflow: `/orch` → conversation → run tasks → complete → conversation continues.
- **Async merge polling (TP-046, issue #136)** — `waitForMergeResult` converted from synchronous `sleepSync` to async `sleepAsync`. Supervisor, heartbeat, and user input remain responsive during the merge phase.
- **Dashboard wave bar fix (TP-045, issue #101)** — completed wave segments now render green instead of black in the progress bar.

### Fixed
- **Agent model defaults** — removed hardcoded `openai/gpt-5.3-codex` from reviewer template and model-specific comments from local templates. All agents default to inheriting the session model.
- **`resolveConfigRoot` export** — fixed `/orch` crash (`resolveConfigRoot is not a function`) caused by missing re-export from config barrel.
- **Supervisor session cleanup** — extension deactivates supervisor on `session_end` to clean heartbeat/lock in normal shutdown paths.
- **Merge result schema tolerance** — parser accepts `source`/`sourceBranch`/`source_branch` and equivalent variants. Merge request includes explicit JSON schema guidance.

### Docs
- Updated commands reference for unified supervisor mode.

## [0.7.0] - 2026-03-23

### New
- **Resume coherence and merge-retry recovery (TP-037)** — resume now checks wave merge outcomes (not just task `.DONE`) so completed-task waves with missing/failed merges are retried instead of skipped; stale pending-task session allocations are cleared to avoid false failure classification on resume.
- **Merge-timeout resilience (TP-038)** — merge timeout handling now checks for a written result file before killing the session, supports timeout retries with exponential backoff, and re-reads config on retry so updated `merge.timeoutMinutes` is respected without restarting.
- **Tier 0 watchdog integration (TP-039)** — deterministic recovery paths are wired into the engine loop with retry budgets, recovery/exhaustion/escalation event emission, and pause-on-exhaustion behavior for operator visibility.
- **Non-blocking orchestration runtime (TP-040)** — `/orch` and `/orch-resume` now return control immediately while batch execution continues asynchronously; engine lifecycle events are persisted to `.pi/supervisor/events.jsonl` for live supervision and dashboard consumption.
- **Supervisor agent (TP-041)** — added `extensions/taskplane/supervisor.ts` with dynamic supervisor prompt injection, lockfile + heartbeat ownership (`.pi/supervisor/lock.json`), startup takeover recovery, `/orch-takeover`, autonomy-level behavior controls, and structured action audit logging.
- **Universal `/orch` routing and onboarding flows (TP-042)** — `/orch` with no args now routes by detected project state (active batch, pending integration, no config, pending tasks, no tasks) and launches supervisor-led onboarding/returning-user conversational flows.
- **Supervisor-managed integration + batch summaries (TP-043)** — supervised/auto integration modes now run from terminal batch callbacks, detect branch protection, execute PR/CI lifecycle flows, and generate structured supervisor batch summaries.
- **Dashboard supervisor panel (TP-044)** — dashboard now surfaces supervisor status, recovery timelines, event context, conversation stream data (when available), and summary content with graceful degradation for pre-supervisor batches.

### Fixed
- **Merge result schema compatibility hardening** — merge result parsing now tolerates known key variants (`source_branch`/`sourceBranch`/`source`, `target_*`, `merge_commit`/`mergeCommit`) and normalizes verification payload variants to prevent false merge hangs/timeouts when agents produce non-canonical keys.
- **Merger prompt schema precision** — merge request generation now embeds an explicit required snake_case JSON schema to reduce model drift in merge result files.
- **Supervisor shutdown cleanup** — extension now deactivates supervisor on session end to clean heartbeat/lock ownership in normal shutdown paths.
- **Task status artifact reconciliation** — TP-037..TP-044 `STATUS.md` files were reconciled after batch completion so staged task records no longer incorrectly show "Not Started".

### Docs
- Updated architecture, command reference, settings reference, first-run orchestration tutorial, and dashboard tutorial for non-blocking engine + supervisor-led workflows.
- Watchdog/supervisor specification docs were finalized and synchronized ahead of implementation.

### Internal
- Added extensive deterministic regression coverage for resume bugs, timeout resilience, watchdog behavior, non-blocking engine flow, supervisor routing/behavior, auto-integration, and merge-result schema compatibility.
- Test suite expanded to **51 files / 2151 tests** at release cut.

## [0.6.1] - 2026-03-20

### New
- **Skip reviews for low-risk steps (TP-036)** — Step 0 (Preflight) and the final step (Documentation & Delivery) now skip plan and code reviews regardless of review level. Saves ~4 review agent invocations per task (~25-30% faster for M-sized tasks). Middle implementation steps are unaffected.

### Docs
- Supervisor-led onboarding scripts added to watchdog spec — 8 conversational scripts for project setup, task area design, git branching, batch planning, health checks, and post-batch retrospectives.

## [0.6.0] - 2026-03-20

### New
- **RPC wrapper & structured diagnostics (TP-025)** — `bin/rpc-wrapper.mjs` wraps `pi --mode rpc` to capture telemetry from worker/reviewer sessions. `TaskExitDiagnostic` interface with 9-way exit classification (`completed`, `api_error`, `context_overflow`, `process_crash`, etc.). Sidecar JSONL files for real-time telemetry with secret redaction.
- **Task-runner RPC integration (TP-026)** — `spawnAgentTmux()` uses the RPC wrapper for `/task` tmux sessions. Sidecar tailing during poll loop provides live token counts and cost. Structured exit diagnostics replace free-text `exitReason`. `/orch` subprocess path unchanged.
- **Dashboard real-time telemetry (TP-027)** — Dashboard displays per-lane token counts, cost, context utilization %, last tool call, retry status, and batch total cost. Graceful degradation for pre-RPC sessions.
- **Partial progress preservation (TP-028)** — Failed tasks with lane branch commits get saved branches (`saved/{opId}-{taskId}-{batchId}`). Commit count and branch name recorded in task outcome. Works in single-repo and workspace mode.
- **Cleanup resilience & post-merge gate (TP-029)** — Fixes issue #93: lane worktrees and branches cleaned up in ALL workspace repos per wave (not just last-wave repos). Force cleanup fallback (`rm -rf` + `git worktree prune`). Post-merge cleanup gate blocks next wave if cleanup fails. Polyrepo acceptance criteria validated after `/orch-integrate`.
- **State schema v3 & migration (TP-030)** — `batch-state.json` schema v3 with `resilience` (retry counters, repair history, failure classification) and `diagnostics` (per-task exit summaries, batch cost) sections. Auto-migration from v1/v2 with conservative defaults. Corrupt state enters `paused` (never auto-deleted). Unknown fields preserved on roundtrip.
- **Force-resume & diagnostic reports (TP-031)** — `/orch-resume --force` for `failed`/`stopped` phases with pre-resume diagnostics. Merge failure defaults to `paused` (not `failed`). Structured diagnostic reports (JSONL event log + human-readable summary) emitted on batch completion/failure.
- **Verification baseline & fingerprinting (TP-032)** — Pre-merge verification baselines per repo. Normalized test output fingerprinting. `newFailures = postMerge - baseline` — pre-existing failures no longer block valid merges. Flaky test handling (re-run once). Strict/permissive modes. Opt-in via `verification.enabled`.
- **Transactional merge & retry matrix (TP-033)** — Merge transaction envelope (capture pre/post refs, rollback on failure, safe-stop if rollback fails). Retry policy matrix with persisted counters scoped by `(repoId, wave, lane)`. Cooldown delays, max attempts, wave gate on cleanup failure.
- **Quality gate structured review (TP-034)** — Opt-in post-completion quality gate. Cross-model structured review with JSON verdict (PASS/NEEDS_FIXES). Severity-classified findings. `.DONE` only created after PASS when enabled. Remediation cycle (max 2 reviews). Configurable via `quality_gate.enabled`.
- **STATUS.md reconciliation & artifact staging scope (TP-035)** — Automatic STATUS.md checkbox correction from quality gate review findings. Artifact staging restricted to task-owned paths only. System-owned template checkboxes removed.
- **Supervisor primer** — `extensions/taskplane/supervisor-primer.md` ships with npm package. Operational runbook for the future supervisor agent covering architecture, recovery patterns, git operations, and batch state management.

### Fixed
- Reviewer APPROVE threshold raised — REVISE now means "will fail without fixes", not "I found something". Minor findings go to Suggestions (no checkboxes), not Issues Found.
- Worker prompt updated — Issues Found items create mandatory checkboxes, Suggestions logged in Notes only.

### Docs
- `docs/specifications/` — moved from `.pi/local/docs/` to git-tracked location for worktree accessibility
- `docs/explanation/waves-lanes-and-worktrees.md` — comprehensive rewrite covering orch branch model, file-scope affinity, batch-scoped worktrees, per-repo merge, integration flow
- `docs/explanation/architecture.md` — updated for JSON config, orch branch flow
- "Repo mode" renamed to "single-repo mode" across all docs
- Watchdog & recovery tiers specification (v2) — interactive supervisor architecture
- AGENTS.md — added JSON config precedence rule (invariant #6)

## [0.5.3] - 2026-03-18

### Fixed
- **Cross-repo TASK_AUTOSTART path resolution** — workspace mode now uses absolute paths for task PROMPT.md so workers in api-service/web-client worktrees can find tasks that live in shared-libs.

## [0.5.12] - 2026-03-19

### Fixed
- **`.DONE` files missing after `/orch-integrate`** — artifact staging was deleting `.DONE` files from the working tree after copying to the merge worktree. After ff integration, they weren't restored. Now `.DONE` files are preserved in the working tree (the stash in `/orch-integrate` handles them).
- **`.worktrees/` directory excluded from artifact staging** — prevents worktree internals from being committed to the orch branch.
- **Test isolation** — config loader tests no longer break when user preferences override reviewer model.

## [0.5.11] - 2026-03-19

### Fixed
- **`/orch-integrate` blocked by dirty STATUS.md files** — workspace mode preserves STATUS.md in the working tree for dashboard visibility, but these dirty files blocked `git merge --ff-only`. Now auto-stashes before integration and pops after.
- **Batch completion message unclear** — simplified to two options: "Apply now (recommended)" and "Push & open PR for review". Removed `--merge` from default display (shown in ff error fallback). Added "Your branch was not modified" reassurance.

## [0.5.10] - 2026-03-19

### Fixed
- **Dashboard wave progress bar stale** — STATUS.md was reverted in develop's working tree after artifact staging, causing the dashboard to show partial checkbox counts for completed waves. Now only .DONE files are removed; STATUS.md modifications are preserved for dashboard visibility.
- **`/orch-integrate` commit count always 0** — count was measured after fast-forward when HEAD already equals orch tip. Now measured before.

## [0.5.9] - 2026-03-18

### Fixed
- **`/orch-integrate` only integrated default repo** — in workspace mode, now loops over all repos that have the orch branch and integrates each one.

## [0.5.8] - 2026-03-18

### Fixed
- **Task artifacts committed to develop instead of orch branch** — `.DONE` and `STATUS.md` files are now staged into the merge worktree (on the orch branch) instead of committed directly to develop. This prevents branch divergence that blocked `/orch-integrate` fast-forward.

## [0.5.7] - 2026-03-18

### Fixed
- **Orch branch only created in default repo** — workspace mode now creates the orch branch in every repo at batch start. Merges target the orch branch directly instead of the repo's current branch, so `/orch-integrate` has actual commits to apply.

## [0.5.6] - 2026-03-18

### Fixed
- **Dashboard missing merge sub-rows for single-repo waves** — Wave 3 merge showed "succeeded" but no lane details when only one repo was involved. Threshold changed from 2+ to 1+ repo results.

## [0.5.5] - 2026-03-18

### Fixed
- **Workspace task artifacts not committed before merge** — workers wrote `.DONE` and `STATUS.md` to the canonical task folder (shared-libs) via absolute paths, leaving them as uncommitted working tree changes. New `commitWorkspaceTaskArtifacts()` runs after each wave before the merge step, committing task artifacts to the task-area repo so they appear in the orch branch and don't block `/orch-integrate`.

## [0.5.4] - 2026-03-18

### Fixed
- **Task completion not detected in workspace mode** — orchestrator polled for `.DONE` inside lane worktrees, but in workspace mode workers write `.DONE` to the canonical task folder (shared-libs). Now resolves `.DONE` and `STATUS.md` from the absolute task folder path in workspace mode. Also fixes dashboard STATUS.md monitoring for cross-repo tasks.

## [0.5.3] - 2026-03-18

### Fixed
- **Cross-repo TASK_AUTOSTART path resolution** — workspace mode now uses absolute paths for task PROMPT.md so workers in api-service/web-client worktrees can find tasks that live in shared-libs.

## [0.5.2] - 2026-03-18

### Fixed
- **TASKPLANE_WORKSPACE_ROOT not set for lane sessions** — env var condition was always false in workspace mode. Lane sessions couldn't find config, showing "0 areas".

## [0.5.1] - 2026-03-18

### Fixed
- **Lane sessions couldn't find task-runner extension** — lane tmux sessions hardcoded `{repoRoot}/extensions/task-runner.ts` which only exists in the taskplane dev repo. Now searches npm global install paths. This was a critical bug preventing workspace/polyrepo mode from working for any project other than taskplane itself.
- **Batch completion message missing integration instructions** — now shows orch branch name and `/orch-integrate` command options.
- **Batch state deleted on clean completion** — state is now preserved when an orch branch exists so `/orch-integrate` can find it.

## [0.5.0] - 2026-03-18

### Added
- **Orchestrator-managed branch model** (issue #24) — `/orch` now creates an ephemeral `orch/{opId}-{batchId}` branch and does all work there. User's HEAD is never touched during batch execution. VS Code stays on whatever branch the user is working on.
- **`/orch-integrate` command** — integrates completed batch work into your working branch. Three modes: fast-forward (default), `--merge` (real merge), `--pr` (push and open GitHub PR). Includes branch safety check (warns if current branch differs from batch origin).
- **Batch-scoped worktree containers** — worktree paths changed from `{prefix}-{opId}-{N}` to `{basePath}/{opId}-{batchId}/lane-{N}`. Prevents directory collisions between concurrent batches. Merge worktree is inside the container.
- **Auto-integration config** — `integration` setting (`"manual"` default, `"auto"` opt-in). Manual = user runs `/orch-integrate`. Auto = fast-forward on completion.
- **Settings reference doc** — `docs/reference/configuration/taskplane-settings.md` documents every setting with types, defaults, options, and descriptions.
- 86 new tests (828 total across 22 test files), including new `orch-integrate.test.ts`.

### Changed
- Wave merges use `git update-ref` instead of `git merge --ff-only` in the main repo — no longer touches the working tree.
- Stash/pop logic removed from merge flow (no longer needed since orch branch is never checked out in main repo).
- Post-merge worktree reset targets orch branch HEAD instead of user's branch.
- Batch completion message shows orch branch name and `/orch-integrate` instructions.

### Fixed
- **Settings TUI input fields freeze terminal** (issue #57) — replaced inline submenu with single-value cycling pattern that exits TUI, then prompts via `ctx.ui.input()`. Works on all platforms.
- Renamed `/settings` to `/taskplane-settings` to avoid collision with pi's built-in `/settings` command.
- Protected branch blindness — `/orch` on a protected branch no longer wastes hours before failing at merge time.

### Removed
- Orchestrator `spawn_mode` setting removed from `/taskplane-settings` TUI — `/orch` always requires tmux, making the setting misleading. The worker-level Spawn Mode (controls `/task` behavior) remains.




## [0.4.0] - 2026-03-17

### Added
- **`/taskplane-settings` TUI command** — interactive config editor with section navigation, source indicators (project/user/default), type-specific controls, and validation. Primary config interface — users rarely need to edit files directly.
- **JSON config schema** — unified `taskplane-config.json` replaces both YAML files. Unified loader with YAML fallback for backward compatibility.
- **`taskplane init` v2** — auto-detects repo vs workspace mode (no `--workspace` flag needed). Enforces selective gitignore entries. Detects and offers to untrack accidentally committed runtime artifacts. Defaults `spawn_mode` to `"tmux"` when available.
- **Pointer file resolution** — workspace mode uses `taskplane-pointer.json` to locate config, agents, and state in the designated config repo. All subsystems (task-runner, orchestrator, dashboard, merge agent) follow the pointer.
- **User preferences** — `~/.pi/agent/taskplane/preferences.json` for personal settings (operator ID, models, tmux prefix, dashboard port). Merged with project config at load time.
- **Doctor enhancements** — gitignore validation, tracked artifact detection, workspace pointer chain validation, config repo default branch check, legacy YAML migration warning, tmux vs `spawn_mode` mismatch detection.
- Configurable merge agent timeout (`merge.timeout_minutes`, default: 10 min, was hardcoded 5 min). Exposed in `/taskplane-settings` TUI.

### Changed
- **Per-step git commits** replace per-checkbox commits — reduces git overhead by ~70-80% without losing recovery capability. STATUS.md is still updated after each checkbox.
- CHANGELOG.md mandatory in release process (AGENTS.md pre-release checklist added).

## [0.3.1] - 2026-03-16

### Added
- Agent prompt inheritance — base prompts ship in package and auto-update on `pi update`. Local `.pi/agents/*.md` files are thin project-specific overrides composed at runtime. `standalone: true` opts out.
- `taskplane init` now scaffolds thin local agent files instead of full copies.

## [0.3.0] - 2026-03-16

### Breaking
- **Node.js minimum raised to 22** (was 20). All CLI commands fail fast with a clear error on older versions. CI updated to Node 22.

### Added
- `taskplane install-tmux` — automated tmux installation for Git Bash on Windows. Downloads from MSYS2 mirrors, no admin rights needed. `--check` for status, `--force` to reinstall/upgrade.
- tmux documented as strongly recommended prerequisite across all public-facing docs.
- `taskplane doctor` suggests `install-tmux` when tmux is missing on Windows.

## [0.2.9] - 2026-03-16

### Added
- `taskplane install-tmux` command (same as v0.3.0 — released before the Node.js bump).

## [0.2.8] - 2026-03-16

### Fixed
- Dashboard STATUS.md eye icon resolves paths correctly in workspace mode (was double-pathing repo prefix).

## [0.2.7] - 2026-03-16

### Fixed
- State/sidecar files (batch-state.json, lane-state, merge results) now write to workspace root's `.pi/` instead of repo root's `.pi/` in workspace mode. Fixes dashboard not showing batch progress.

## [0.2.6] - 2026-03-16

### Fixed
- Tolerate flat `verification_passed`/`verification_commands` fields in merge result JSON (merge agents may write flat fields instead of nested `verification` object).

## [0.2.5] - 2026-03-16

### Fixed
- Normalize merge result `status` field to uppercase before validation. Merge agents may write lowercase (`"success"` vs `"SUCCESS"`).

## [0.2.4] - 2026-03-16

### Fixed
- Worktree base branch resolved from current HEAD instead of `default_branch` in workspace config. Was causing worktrees to branch from `develop` instead of the user's feature branch.

## [0.2.3] - 2026-03-16

### Fixed
- Thread `TASKPLANE_WORKSPACE_ROOT` env var to lane sessions so task-runner can find `.pi/task-runner.yaml` in workspace mode.

## [0.2.2] - 2026-03-16

### Fixed
- Discovery resolves task area paths from workspace root (not repo root) in workspace mode.

## [0.2.1] - 2026-03-16

### Fixed
- Preflight `git worktree list` check runs from repo root in workspace mode (workspace root is not a git repo).

## [0.2.0] - 2026-03-15

### Added
- **Polyrepo workspace mode** — multi-repository orchestration with per-repo lanes, merges, and resume.
- Workspace config (`.pi/taskplane-workspace.yaml`) with repo definitions, routing, and strict mode.
- Task repo routing via `## Execution Target` in PROMPT.md.
- Repo-scoped lane allocation with global lane numbering.
- Repo-scoped merge sequencing with partial-success reporting.
- Operator-scoped naming for sessions, worktrees, branches, and merge artifacts (collision resistance).
- Schema v2 persistence with repo-aware task/lane records and v1→v2 auto-upconversion.
- Resume reconciliation across repos.
- Dashboard repo filter, badges, and per-repo merge sub-rows.
- Strict routing enforcement (`routing.strict: true`).
- 398 tests across 15 test files.

## [0.1.18] - 2026-03-15

### Changed
- Rebalanced hydration philosophy — outcome-level checkboxes (2-5 per step) replace exhaustive implementation scripts (15+ micro-checkboxes).
- Updated task-worker and task-reviewer agent prompts with "Adaptive Planning, Not Exhaustive Scripting" guidance.

## [0.1.17] - 2026-03-15

### Fixed
- Dashboard eye icon contrast improved — higher opacity, accent color on hover/active states, box-shadow ring for on/off distinction.

## [0.1.16] - 2026-03-15

### Fixed
- Minor bug fixes and stability improvements.

## [0.1.15] - 2026-03-15

### Fixed
- Minor bug fixes and stability improvements.

## [0.1.14] - 2026-03-15

### Fixed
- `taskplane doctor` now parses task-area `context:` paths only from the `task_areas` block, preventing false-positive CONTEXT warnings from unrelated YAML sections.

## [0.1.13] - 2026-03-15

### Added
- `taskplane init --tasks-root <relative-path>` to target an existing task directory (for example `docs/task-management`) instead of creating an alternate task area path.

### Changed
- When `--tasks-root` is provided, sample task packets are skipped by default; pass `--include-examples` to scaffold examples intentionally into that directory.

## [0.1.12] - 2026-03-15

### Added
- `taskplane uninstall` CLI command with project cleanup + optional package uninstall scopes (`--package`, `--package-only`, `--local`, `--global`, `--remove-tasks`, `--all`, `--dry-run`).
- Dynamic example scaffolding in `taskplane init`: all `templates/tasks/EXAMPLE-*` packets are now discovered and generated.
- Second default example task packet: `EXAMPLE-002-parallel-smoke`.
- GitHub governance baseline for OSS collaboration:
  - CI workflow (`.github/workflows/ci.yml`)
  - Dependabot config
  - CODEOWNERS
  - Docs improvement issue form + issue template config

### Changed
- Onboarding is now orchestrator-first (`/orch-plan all` + `/orch all` + dashboard), with `/task` documented as explicit single-task mode.
- Docs now explicitly clarify `/task` runs in current branch/worktree while `/orch` uses isolated worktrees (recommended default even for single-task isolation).
- `AGENTS.md` now includes branching/PR workflow and release-playbook guidance for coding agents.
- Maintainer documentation expanded with repository governance and release mapping between GitHub releases and npm publish.

### Fixed
- CI baseline now avoids peer-dependency import failures from extension runtime-only modules in this repo context.
- Branch protection/check naming documentation aligned with the required GitHub check context (`ci`).

## [0.1.11] - 2026-03-14

### Added
- Taskplane CLI package entrypoint (`taskplane`) with init/doctor/version/dashboard commands
- Web dashboard packaging under `dashboard/` with CLI launch support
- Project scaffolding via `taskplane init` (configs, agents, task templates)
- Dependency-aware parallel orchestration commands (`/orch*`)
- Batch persistence and resume foundations (`/orch-resume`, persisted batch state)

### Changed
- Package layout aligned for pi package distribution (`extensions/`, `skills/`, `templates/`, `dashboard/`)
- Documentation strategy shifted to phased, public open-source structure

### Fixed
- Dashboard root resolution based on runtime `--root` instead of hardcoded repo path

[Unreleased]: https://github.com/HenryLach/taskplane/compare/v0.20.0...HEAD
[0.20.0]: https://github.com/HenryLach/taskplane/compare/v0.19.0...v0.20.0
[0.19.0]: https://github.com/HenryLach/taskplane/compare/v0.18.1...v0.19.0
[0.18.1]: https://github.com/HenryLach/taskplane/compare/v0.18.0...v0.18.1
[0.18.0]: https://github.com/HenryLach/taskplane/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/HenryLach/taskplane/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/HenryLach/taskplane/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/HenryLach/taskplane/compare/v0.14.1...v0.15.0
[0.14.1]: https://github.com/HenryLach/taskplane/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/HenryLach/taskplane/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/HenryLach/taskplane/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/HenryLach/taskplane/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/HenryLach/taskplane/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/HenryLach/taskplane/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/HenryLach/taskplane/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/HenryLach/taskplane/compare/v0.9.3...v0.10.0
[0.9.3]: https://github.com/HenryLach/taskplane/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/HenryLach/taskplane/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/HenryLach/taskplane/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/HenryLach/taskplane/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/HenryLach/taskplane/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/HenryLach/taskplane/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/HenryLach/taskplane/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/HenryLach/taskplane/compare/v0.7.1...v0.7.2
[0.7.0]: https://github.com/HenryLach/taskplane/compare/v0.6.1...v0.7.0
[0.1.14]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.14
[0.1.13]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.13
[0.1.12]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.12
[0.1.11]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.11
