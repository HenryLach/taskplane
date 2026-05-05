# TP-184: Always include engine bridge tools in worker `--tools` allowlist — Status

**Current Step:** Step 6: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-05-05
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main`, working tree clean (orchestrated lane branch `task/henrylach-lane-1-20260504T230343`; only STATUS.md modified, expected)
- [x] Baseline test count recorded: 3429 passing (3430 total, 1 skipped) — drift up from 3420 due to intervening merges, no concern
- [x] Tier 3 source files read; spawn pipeline understood end-to-end (env-vars → execution.ts:2656 → LaneRunnerConfig.workerTools → lane-runner.ts:580 → AgentHostOptions.tools → agent-host.ts:260 → `pi --tools` arg)
- [x] `agent-bridge-extension.ts` confirmed to register exactly the three tools (`notify_supervisor`@137, `request_segment_expansion`@230, `review_step`@599) — matches `ENGINE_BRIDGE_TOOLS` exactly
- [x] Bug reproduced via code inspection: lane-runner.ts:580 hardcodes `"read,write,edit,bash,grep,find,ls"` fallback which omits the three bridge tools; pi's tool gate then filters them out at the worker

---

### Step 1: Implement the helper and constants
**Status:** ✅ Complete

- [x] `ENGINE_BRIDGE_TOOLS` const exported from `agent-host.ts` (readonly 3-tuple) at line 81
- [x] `DEFAULT_WORKER_USER_TOOLS` const exported from `agent-host.ts` at line 103
- [x] `buildWorkerToolsAllowlist(userTools)` helper exported at line 125, with semantics:
   - falsy/empty/whitespace input → fall back to default user tools
   - non-empty input → split, trim, filter, dedupe
   - always append bridge tools (deduped via `Set`)
- [x] JSDoc with `@since TP-184` and reference to issue #530 (https://github.com/HenryLach/taskplane/issues/530)

---

### Step 2: Wire the helper into the lane-runner spawn site
**Status:** ✅ Complete

- [x] `lane-runner.ts` spawn site calls `buildWorkerToolsAllowlist(config.workerTools)` (replaces the literal fallback; imports added at line 35)
- [x] `execution.ts` LaneRunnerConfig defaulting uses `DEFAULT_WORKER_USER_TOOLS` for default (does NOT call the helper) — import added near `executeTaskV2` import
- [x] `config-schema.ts` (worker default + merge tools) and `types.ts` (merge tools) literals annotated with comments pointing at canonical constant; literals retained because (a) types.ts → agent-host → types.ts would be circular, (b) config-schema.ts is currently import-free and importing agent-host.ts would pull child_process/fs into the schema layer
- [x] No double-augmentation: helper is called exactly once at lane-runner.ts spawn site; execution.ts only sets the user-tools default

---

### Step 3: Add a defensive startup sanity check
**Status:** ✅ Complete

- [x] Validation runs immediately after `hostOpts` literal closes, before `spawnAgent()` is called
- [x] Missing bridge tool emits `logExecution(statusPath, "WARN", ...)` line; does NOT throw or block spawn
- [x] Warning text identifies the missing tool by name and explains the silent-failure consequence

---

### Step 4: Add unit tests
**Status:** ✅ Complete

- [x] `extensions/tests/worker-tools-allowlist.test.ts` created modeled on `worker-model.test.ts`
- [x] All 8 helper-behavior cases covered (undefined/null/empty/whitespace/custom/already-includes-bridge/whitespace-and-empty-entries/output-format) plus a 9th dedup-overall case
- [x] All 3 `ENGINE_BRIDGE_TOOLS` shape cases covered (count, exact entries, alignment with `agent-bridge-extension.ts` via source-text scan) plus 2 `DEFAULT_WORKER_USER_TOOLS` shape cases
- [x] Targeted run passes: 14/14 tests

---

### Step 5: Testing & Verification
**Status:** ✅ Complete

> ZERO test failures allowed.

- [x] FULL fast suite passing: 3443/3443 (1 skipped)
- [x] Integration suite passing: 403/403
- [x] Pass count = baseline (3429) + new tests (14) = 3443 — exact match
- [x] `lane-runner-v2.test.ts` test 3.6 still passes — 6000-byte window did NOT need re-widening (the helper-call change was on a single line in lane-runner.ts, not in execution.ts's `executeLaneV2` body that test 3.6 scans)
- [x] `worker-model.test.ts` (TP-181) still passes — 11/11
- [x] CLI smoke clean: `taskplane help` and `taskplane doctor` both run; doctor errors are expected (worktree without project config)
- [x] Optional manual sanity skipped — covered by Step 4 unit tests + Step 3 defensive sanity check

---

### Step 6: Documentation & Delivery
**Status:** ✅ Complete

- [x] `taskplane-settings.md` Worker Tools row clarified: bold **user-facing** scoping, explicit list of bridge tools (`review_step`, `notify_supervisor`, `request_segment_expansion`) always-appended, link to issue #530
- [x] `CHANGELOG.md` Unreleased / Fixed entry added (TP-184, #530) with full description
- [x] Discoveries logged below
- [N/A] Branch + PR opened per AGENTS.md branching policy — orchestrated lane run; supervisor handles merge/PR via merge agent

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `config-schema.ts` is currently import-free; importing `DEFAULT_WORKER_USER_TOOLS` from `agent-host.ts` would pull `child_process`/`fs` into a pure schema layer | Kept literal with a `NOTE (TP-184)` comment pointing at the canonical constant | `extensions/taskplane/config-schema.ts:597,654` |
| `types.ts` is imported by `agent-host.ts`, so importing the constant the other direction would create a cycle | Kept literal with a `NOTE (TP-184)` comment | `extensions/taskplane/types.ts:397` |
| `lane-runner-v2.test.ts` test 3.6 6000-byte window did NOT need re-widening | Verified: helper-call change was in `lane-runner.ts` (not in `executeLaneV2` body that test 3.6 scans) | `extensions/tests/lane-runner-v2.test.ts:175` |
| Pass count delta exactly matches new tests added (14) | Confirms no regressions; baseline 3429 → 3443 | full suite |
| `templates/agents/task-worker.md` still says "If you have access to a `review_step` tool" — with this fix the conditional is now stale | Out of scope for TP-184 (PROMPT explicitly defers); follow-up doc-only change recommended | `templates/agents/task-worker.md:247-290` |
| The `supervisor-primer.md` literal at lines 1359 and 1395 also matches the default — it's a documentation example not a runtime path | Left as-is; matches the actual default value | `extensions/taskplane/supervisor-primer.md:1359,1395` |
| `config-schema.ts` merge-tools default and `types.ts` merge-tools default are independent of the worker plumbing (merge agent doesn't go through `buildWorkerToolsAllowlist`) | Annotated with comments noting the independence; left as literals | `extensions/taskplane/config-schema.ts:654`, `extensions/taskplane/types.ts:397` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-04 | Task staged | PROMPT.md and STATUS.md created |
| 2026-05-05 03:03 | Task started | Runtime V2 lane-runner execution |
| 2026-05-05 03:03 | Step 0 started | Preflight |
| 2026-05-05 03:13 | Worker iter 1 | done in 574s, tools: 78 |
| 2026-05-05 03:13 | Task complete | .DONE created |

---

## Blockers

*None*

---

## Notes

- Issue #530 was filed by an agent in the `Emailgistics/emailgistics-astro` project after observing zero `review_step` calls in a Review-Level-1 batch run.
- This task builds directly on TP-181 (PR #522) which wired `taskRunner.worker.tools` from preferences through env vars. The user-config plumbing is already in place; this task adds the always-append-bridge-tools layer on top.
- The base prompt at `templates/agents/task-worker.md` says "If you have access to a `review_step` tool" — that conditional was the only thing keeping this from being a hard prompt contradiction. After this fix, the tool is reliably present. Tightening the wording is intentionally deferred to a follow-up so this task stays scoped to the wiring fix.
