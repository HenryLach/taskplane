# Plan Review — TP-080 Step 4 (Testing & Verification)

## Verdict: REVISE

Step 4 is not implementation-ready yet. The current Step 4 checklist in `STATUS.md` is still too generic and misses required coverage from `PROMPT.md`.

## What I reviewed

- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/PROMPT.md`
- `taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/STATUS.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/waves.ts`
- `extensions/tests/discovery-routing.test.ts`
- `extensions/tests/waves-repo-scoped.test.ts`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/package.json`

## Why revision is required

1. **Mandatory artifact missing from Step 4 plan**
   - `PROMPT.md` explicitly requires creating `extensions/tests/segment-model.test.ts` with behavioral tests.
   - Current Step 4 checklist does not include this required file.

2. **Coverage matrix is not specific enough to catch known contract risks**
   Current bullets do not define concrete assertions for critical TP-080 contracts. At minimum Step 4 needs explicit test cases for:
   - repo-mode fallback behavior (`repo-singleton`) even when `fileScope` has multiple directory prefixes,
   - `computeWaveAssignments()` return-shape behavior for error paths (segment plan presence/absence must be tested intentionally),
   - deterministic ordering contracts (task map key ordering, segment ordering, edge ordering),
   - explicit-DAG authority vs inferred fallback in mixed batches,
   - backward compatibility when `## Segment DAG` is absent.

3. **Test file targeting is ambiguous**
   - Step 4 should specify which cases go into:
     - `segment-model.test.ts` (cross-contract behavior, planner/discovery integration-style checks),
     - `discovery-routing.test.ts` (parser/validation behavior),
     - `waves-repo-scoped.test.ts` (inference and deterministic planner mechanics),
     - `polyrepo-regression.test.ts` (non-regression/backward compatibility guard in workspace flows).

4. **Full-suite command drift from task prompt**
   - `PROMPT.md` requires running:
     - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
   - Current Step 4 uses `npx vitest run` only. Update plan to include the required prompt command (you may still run extra commands additionally).

## Required plan updates before implementation

1. Add explicit checkbox to **create `extensions/tests/segment-model.test.ts`** (behavioral-only assertions).
2. Hydrate Step 4 with named test cases (not generic bullets), including:
   - explicit metadata parse + normalization + validation regression,
   - inferred fallback determinism,
   - repo-mode singleton fallback guard,
   - computeWaveAssignments segment plan contract on both success and failure paths,
   - no-metadata backward compatibility regression.
3. Add explicit mapping of each case to target test file.
4. Update execution checklist to run the required full-suite command from `PROMPT.md`, then fix all failures.

## Non-blocking guidance

- Keep Step 4 tests contract-driven and black-box where possible (inputs/outputs), not implementation-shape/source-pattern checks.
- Prefer stable, deterministic fixture setup so edge-order assertions don’t become flaky.
