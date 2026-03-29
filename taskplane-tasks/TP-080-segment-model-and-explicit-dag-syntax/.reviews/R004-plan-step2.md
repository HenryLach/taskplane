# Plan Review — TP-080 Step 2 (Support optional explicit segment DAG metadata)

## Verdict: REVISE

Step 2 is not implementation-ready yet. The current Step 2 plan in `STATUS.md` is still too generic for a parser/validation change that introduces new fatal discovery errors.

## What I reviewed

- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/PROMPT.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/discovery-routing.test.ts`
- `extensions/task-runner.ts` (parser tolerance for additional prompt metadata sections)
- `docs/specifications/taskplane/multi-repo-task-execution.md`

## Why revision is required

Step 2 currently says only:
- parse optional metadata
- keep backward compatibility
- fail fast for unknown repos/cycles

That does not yet define the concrete syntax contract, parsing/validation boundaries, or exact error mapping needed to implement deterministically and test reliably.

## Required plan fixes before implementation

1. **Define the exact `## Segment DAG` syntax to support in v1.**
   - Required headings/keys (e.g., `Repos:` and `Edges:` blocks).
   - Allowed line formats (e.g., `- api-service`, `- api-service -> web-client`).
   - Whether markdown decoration variants are accepted (`**Repos:**`, extra whitespace, etc.).

2. **Define validation semantics unambiguously.**
   - Unknown repo in an edge means “not present in explicit `repoIds` list” (or other source—must be explicit).
   - Self-edge handling (`A -> A`) and cycle handling (e.g., `A -> B -> A`) must be explicitly called out.
   - Decide whether empty section / missing repos / malformed edge lines are ignored vs fatal.

3. **Define error-code mapping and failure behavior.**
   - Use `SEGMENT_REPO_UNKNOWN` for unknown edge endpoints.
   - Use `SEGMENT_DAG_INVALID` for malformed syntax and cycle/self-cycle cases.
   - Confirm parse failure behavior aligns with existing `parsePromptForOrchestrator` contract (`task: null`, `error` set).

4. **Lock deterministic normalization rules for parsed metadata.**
   - Repo IDs: lowercase + validation pattern parity with routing IDs.
   - Dedup rules for repos/edges.
   - Edge sort order (`fromRepoId`, then `toRepoId`) before attaching to `ParsedTask.explicitSegmentDag`.

5. **Call out compatibility behavior explicitly.**
   - If `## Segment DAG` section is absent, `explicitSegmentDag` remains `undefined` and discovery behavior is unchanged.
   - Unknown/non-segment metadata sections remain ignored (current parser behavior).

6. **Hydrate Step 2 test plan with concrete cases.**
   Add named tests in `extensions/tests/discovery-routing.test.ts` for:
   - valid explicit DAG parse
   - metadata absent (backward-compat)
   - unknown repo in edge → `SEGMENT_REPO_UNKNOWN`
   - obvious cycle/self-cycle → `SEGMENT_DAG_INVALID`
   - fatal classification in `formatDiscoveryResults` (errors, not warnings)

## Non-blocking implementation guidance

- Reuse existing section-boundary parsing pattern in `discovery.ts` (header index + slice to next `##`/`---`) rather than a fragile single regex.
- Keep validation deterministic (sorted traversal) so cycle error messages are stable across runs.
