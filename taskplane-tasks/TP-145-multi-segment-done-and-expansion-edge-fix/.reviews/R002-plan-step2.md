## Plan Review: Step 2 — Fix expansion edge validation

### Verdict: APPROVE

### Summary
The four checkboxes correctly capture the outcomes needed to fix Bug #2. The validation function at `engine.ts:349-352` currently rejects edges referencing repos outside `requestedRepoIds`; the plan addresses this by allowing anchor/completed-segment repos, stripping redundant edges, and testing. The worker has all necessary context available through the existing function parameters (`segmentState.orderedSegments` for repoId lookup, `segmentState.statusBySegmentId` for completed-segment identification).

### Issues Found
No blocking issues.

### Missing Items
None — the plan covers the three behavioral changes (accept anchor repo in edges, accept completed-segment repos, strip redundant edges) and testing.

### Suggestions

- **Anchor repoId resolution:** The validation function already receives `segmentId` and `segmentState` (which contains `orderedSegments: TaskSegmentNode[]`). The anchor's repoId can be resolved via `segmentState.orderedSegments.find(s => s.segmentId === segmentId)?.repoId`. For completed repos, `segmentState.statusBySegmentId` gives statuses and `orderedSegments` gives repoIds. No new parameters needed on the function signature.

- **Cycle detection is already safe:** `expansionRequestHasCycle` (engine.ts:274) only builds its topo-sort graph from `requestedRepoIds`. Its `if (!indegree.has(edge.from) || !indegree.has(edge.to)) continue;` at line 283 silently skips edges referencing external (anchor/completed) repos. So no change to cycle detection is needed — just be aware of this when reasoning about the fix.

- **Mutation code already tolerant:** `applySegmentExpansionMutation` at line 542 maps `edge.from`/`edge.to` via `segmentIdByRequestedRepoId` (built from `requestedRepoIds` only) and silently skips edges with unmapped repos (`if (!fromSegmentId || !toSegmentId) continue;`). Explicit stripping in validation (as the PROMPT requests) is cleaner, but there's no risk of crash if an edge leaks through.

- **Consider both `from` and `to` directions:** The PROMPT's primary scenario is `{ from: anchor, to: newRepo }`, but it's worth also allowing `to` to reference an existing repo (e.g., `{ from: "new-web", to: "shared-libs" }`). The plan's "Allow completed segment repos in edges" checkbox is broad enough to cover both directions — just be deliberate about handling both in the implementation.

- **Test the existing cycle-detection test still passes:** The existing test at segment-expansion-engine.test.ts line ~170 tests cycle detection with edges like `[{ from: "api", to: "web" }, { from: "web", to: "api" }]` where both repos ARE in `requestedRepoIds`. Ensure this still rejects after the validation loosening — it should, since both repos are in the requested set and the cycle logic applies to intra-request edges.
