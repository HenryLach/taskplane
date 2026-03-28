# Plan Review — TP-080 Step 2 (Support optional explicit segment DAG metadata)

## Verdict: APPROVE

The Step 2 plan in `STATUS.md` is now implementation-ready and addresses the prior R004 gaps.

## What I reviewed

- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/PROMPT.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/.reviews/R004-plan-step2.md`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/discovery-routing.test.ts`
- `docs/specifications/taskplane/multi-repo-task-execution.md`

## Why this is approved

The revised Step 2 checklist now explicitly covers:

1. **Concrete syntax contract** for `## Segment DAG` (`Repos:` and `Edges:` blocks, accepted markdown/whitespace variants).
2. **Deterministic normalization rules** (lowercasing, dedupe, edge sorting).
3. **Validation semantics** (unknown edge endpoints, malformed lines, self-edge, cycles).
4. **Stable error mapping** (`SEGMENT_REPO_UNKNOWN`, `SEGMENT_DAG_INVALID`) and parse contract behavior (`task: null`, `error` set).
5. **Backward compatibility expectations** when section is absent and for unrelated metadata.
6. **Hydrated test plan** in `discovery-routing.test.ts`, including fatal classification expectations.

This is specific enough to implement without ambiguity and aligns with existing discovery parsing patterns.

## Non-blocking implementation notes

- Keep `repoIds` ordering deterministic as **first-seen order** (per `PromptSegmentDagMetadata` contract in `types.ts`) while still deduplicating.
- Treat invalid repo IDs in `Repos:` (pattern mismatch) as `SEGMENT_DAG_INVALID` for consistency with fail-fast explicit metadata behavior.

