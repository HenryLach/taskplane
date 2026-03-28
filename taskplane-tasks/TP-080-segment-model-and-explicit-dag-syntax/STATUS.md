# TP-080: Segment Model and Optional Explicit DAG Syntax — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-28
**Review Level:** 2
**Review Counter:** 12
**Iteration:** 4
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read current task parsing and routing flow from discovery to waves
- [x] Identify where file-scope/repo attribution can seed segment inference
- [x] Confirm existing parser behavior for unknown metadata blocks in `PROMPT.md`

---

### Step 1: Add segment contracts
**Status:** ✅ Complete

- [x] Define additive segment contracts in `extensions/taskplane/types.ts`
  - [x] `SegmentId` helper contract + `buildSegmentId(taskId, repoId)` rule: `<taskId>::<repoId>`
  - [x] `TaskSegmentNode` (`segmentId`, `taskId`, `repoId`, deterministic `order`)
  - [x] `TaskSegmentEdge` (`fromSegmentId`, `toSegmentId`, `provenance`)
  - [x] `TaskSegmentPlan` (`taskId`, ordered `segments`, ordered `edges`, `mode`)
- [x] Define explicit metadata contract on parsed tasks
  - [x] `PromptSegmentDagMetadata` with ordered `repoIds` + `edges` (`fromRepoId`, `toRepoId`)
  - [x] ParsedTask field remains optional to preserve backward compatibility
- [x] Lock deterministic ordering semantics in contract comments
  - [x] Segments sorted by `order` then `repoId`
  - [x] Edges sorted by `fromSegmentId` then `toSegmentId`
  - [x] Task-level map iteration sorted by `taskId`
- [x] Add edge provenance typing for observability
  - [x] `SegmentEdgeProvenance = "explicit" | "inferred"`
  - [x] Optional `reason` string for debug/telemetry context
- [x] Clarify repo-mode handling
  - [x] Segment planning is workspace-oriented in TP-080; repo mode yields a single synthetic repo segment using `task.resolvedRepoId ?? "default"`

---

### Step 2: Support optional explicit segment DAG metadata
**Status:** ✅ Complete

- [x] Add parser support for optional `## Segment DAG` metadata in `PROMPT.md`
  - [x] Accept `Repos:` list lines (`- api`, `- web-client`) and `Edges:` lines (`- api -> web-client`)
  - [x] Accept markdown decoration/whitespace variants (`**Repos:**`, indented bullets)
  - [x] Keep existing section-boundary parsing style (slice to next `##` / `---`)
- [x] Normalize and persist parsed metadata deterministically
  - [x] Repo IDs normalized to lowercase with routing-equivalent ID validation
  - [x] De-duplicate repo IDs and edges
  - [x] Sort edges by `fromRepoId`, then `toRepoId` before attaching to task metadata
- [x] Validate explicit DAG with fail-fast discovery errors
  - [x] `SEGMENT_REPO_UNKNOWN` when edge endpoint is not in explicit repo list
  - [x] `SEGMENT_DAG_INVALID` for malformed lines, self-edge, or cycles
  - [x] Keep `parsePromptForOrchestrator` contract (`task: null`, `error` set) for malformed section syntax
- [x] Preserve backward compatibility
  - [x] If `## Segment DAG` is absent, `explicitSegmentDag` stays undefined
  - [x] Unknown non-segment metadata sections remain ignored
- [x] Hydrate tests in `extensions/tests/discovery-routing.test.ts`
  - [x] Valid explicit DAG parse + normalization
  - [x] Metadata absent non-regression
  - [x] Unknown edge repo fatal (`SEGMENT_REPO_UNKNOWN`)
  - [x] Cycle/self-cycle fatal (`SEGMENT_DAG_INVALID`)

---

### Step 3: Deterministic inference fallback
**Status:** ✅ Complete

- [x] Wire segment plans into planner output (`waves.ts`)
  - [x] `computeWaveAssignments()` always returns additive `segmentPlans`
  - [x] Existing `waves` lane assignment output remains behaviorally unchanged
  - [x] Populate map in deterministic `taskId` sort order
- [x] Define deterministic inference input precedence for tasks without explicit DAG
  - [x] Parse repo touches from `fileScope` first path segment (normalized separators/case)
  - [x] Preserve first-seen order while de-duping repo touches
  - [x] Use dependency task repo IDs as stabilization signal (deterministic tie-break)
  - [x] Fallback to `task.resolvedRepoId`, else repo-mode synthetic `default`
  - [x] Explicitly out-of-scope: checklist prose parsing (not in `ParsedTask` contract)
- [x] Represent one-active-segment policy in plan edges
  - [x] Build linear chain edges for inferred multi-segment plans (`s0 -> s1 -> ...`)
  - [x] Mark inferred edges with `provenance: "inferred"` and stable `reason` text
  - [x] Sort edges by `fromSegmentId`, then `toSegmentId`
- [x] Preserve explicit DAG authority in mixed batches
  - [x] Tasks with `explicitSegmentDag` map to `mode: "explicit-dag"`
  - [x] Inference must not overwrite explicit repo/edge definitions
  - [x] Repo-singleton fallback uses `mode: "repo-singleton"`
- [x] Hydrate tests in `extensions/tests/waves-repo-scoped.test.ts`
  - [x] Deterministic inference from file-scope multi-repo hints
  - [x] Singleton fallback with no fileScope hints
  - [x] One-active-segment chain edge generation
  - [x] Deterministic map output across different input map insertion orders
  - [x] Mixed explicit + inferred plans with stable `mode` + provenance

---

### Step 4: Testing & Verification
**Status:** ✅ Complete

- [x] Create `extensions/tests/segment-model.test.ts` with behavioral contract tests
  - [x] Task-segment ID contract (`<taskId>::<repoId>`) and deterministic ordering checks
  - [x] `computeWaveAssignments()` segment-plan shape on success and error paths
- [x] Extend parser coverage in `extensions/tests/discovery-routing.test.ts`
  - [x] Explicit `## Segment DAG` parse + normalization + fail-fast validation
  - [x] Backward compatibility when metadata is absent
- [x] Extend inference/planner coverage in `extensions/tests/waves-repo-scoped.test.ts`
  - [x] Deterministic inferred ordering + one-active linear edge chain
  - [x] Explicit DAG authority in mixed explicit/inferred batches
  - [x] Repo-mode singleton fallback guard (including noisy file-scope prefixes)
- [x] Add non-regression guard in `extensions/tests/polyrepo-regression.test.ts`
  - [x] Segment-plan map presence without changing existing wave/lane behavior
- [x] Run required full suite command from prompt
  - [x] `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [x] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ✅ Complete

- [x] Update spec wording if implementation reveals syntax or validation constraints
- [x] Log discoveries in STATUS.md
- [x] Create `.DONE`

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | plan | Step 1 | APPROVE | .reviews/R002-plan-step1.md |
| R003 | code | Step 1 | APPROVE | .reviews/R003-code-step1.md |
| R004 | plan | Step 2 | REVISE | .reviews/R004-plan-step2.md |
| R005 | plan | Step 2 | APPROVE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | APPROVE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | plan | Step 3 | APPROVE | .reviews/R008-plan-step3.md |
| R009 | code | Step 3 | APPROVE | .reviews/R009-code-step3.md |
| R010 | plan | Step 4 | REVISE | .reviews/R010-plan-step4.md |
| R011 | plan | Step 4 | APPROVE | .reviews/R011-plan-step4.md |
| R012 | code | Step 4 | APPROVE | .reviews/R012-code-step4.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Repo-mode false positives from `fileScope` prefixes (`src/`, `lib/`) can incorrectly create synthetic segments when no workspace repo IDs are known. | Added repo-mode guard: ignore file-scope repo extraction when known repo set is empty; fall back to `repo-singleton`. | `extensions/taskplane/waves.ts` (`inferTaskRepoOrder`) |
| Explicit `## Segment DAG` is safer when normalized + fail-fast validated at parse time and revalidated against workspace repo map during routing. | Added parse-time validation (`SEGMENT_DAG_INVALID`/`SEGMENT_REPO_UNKNOWN`) and workspace-ID validation in routing. | `extensions/taskplane/discovery.ts` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-28 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-28 15:49 | Task started | Extension-driven execution |
| 2026-03-28 15:49 | Step 0 started | Preflight |
| 2026-03-28 15:49 | Task started | Extension-driven execution |
| 2026-03-28 15:49 | Step 0 started | Preflight |
| 2026-03-28 15:49 | Worker iter 1 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-28 15:49 | No progress | Iteration 1: 0 new checkboxes (1/3 stall limit) |
| 2026-03-28 15:49 | Worker iter 2 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-28 15:49 | No progress | Iteration 2: 0 new checkboxes (2/3 stall limit) |
| 2026-03-28 15:49 | Worker iter 3 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-28 15:49 | No progress | Iteration 3: 0 new checkboxes (3/3 stall limit) |
| 2026-03-28 15:49 | Task blocked | No progress after 3 iterations |
| 2026-03-28 15:49 | Worker iter 2 | done in 8s, ctx: 0%, tools: 0 |
| 2026-03-28 15:49 | No progress | Iteration 1: 0 new checkboxes (1/3 stall limit) |
| 2026-03-28 15:49 | Worker iter 3 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-28 15:49 | No progress | Iteration 2: 0 new checkboxes (2/3 stall limit) |
| 2026-03-28 15:49 | Worker iter 4 | done in 3s, ctx: 0%, tools: 0 |
| 2026-03-28 15:49 | No progress | Iteration 3: 0 new checkboxes (3/3 stall limit) |
| 2026-03-28 15:49 | Task blocked | No progress after 3 iterations |
| 2026-03-28 15:52 | Reviewer R001 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 15:54 | Review R001 | plan Step 1: REVISE (fallback) |
| 2026-03-28 15:55 | Reviewer R002 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |
| 2026-03-28 15:56 | Review R002 | plan Step 1: APPROVE (fallback) |
| 2026-03-28 15:57 | Reviewer R003 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 16:01 | Review R003 | code Step 1: APPROVE (fallback) |
| 2026-03-28 16:01 | Reviewer R004 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 16:03 | Review R004 | plan Step 2: REVISE (fallback) |
| 2026-03-28 16:04 | Reviewer R005 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |
| 2026-03-28 16:05 | Review R005 | plan Step 2: APPROVE (fallback) |
| 2026-03-28 16:08 | Reviewer R006 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 16:13 | Review R006 | code Step 2: APPROVE (fallback) |
| 2026-03-28 16:13 | Reviewer R007 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 16:15 | Review R007 | plan Step 3: REVISE (fallback) |
| 2026-03-28 16:15 | Reviewer R008 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 16:17 | Review R008 | plan Step 3: APPROVE (fallback) |
| 2026-03-28 16:20 | Reviewer R009 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 16:25 | Review R009 | code Step 3: APPROVE (fallback) |
| 2026-03-28 16:25 | Reviewer R010 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 16:27 | Review R010 | plan Step 4: REVISE (fallback) |
| 2026-03-28 16:28 | Reviewer R011 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer session died while waiting for verdict |
| 2026-03-28 16:29 | Review R011 | plan Step 4: APPROVE (fallback) |
| 2026-03-28 16:33 | Reviewer R012 | persistent reviewer failed — falling back to fresh spawn: Persistent reviewer exited within 30s of spawn without producing a verdict — wait_for_review tool may not be supported by this model (e.g., called via bash instead of as a registered tool) |
| 2026-03-28 16:37 | Review R012 | code Step 4: APPROVE (fallback) |
| 2026-03-28 16:45 | Step 0 complete | Preflight checklist completed |
| 2026-03-28 16:50 | Step 1 complete | Added segment contracts in `types.ts` |
| 2026-03-28 16:58 | Step 2 complete | Added explicit `## Segment DAG` parser + validation |
| 2026-03-28 17:08 | Step 3 complete | Added deterministic segment inference + `segmentPlans` planner output |
| 2026-03-28 17:22 | Step 4 complete | Added/updated tests and passed full Node test suite |
| 2026-03-28 17:24 | Step 5 complete | Updated docs and prepared `.DONE` |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
