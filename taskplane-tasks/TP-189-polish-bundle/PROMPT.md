# Task: TP-189 - Accumulated polish bundle (sage follow-ups + diagnostic UX + CI alignment)

**Created:** 2026-05-06
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Bundle of small, mostly-independent polish items deferred from TP-181, TP-184, TP-185, and TP-186 sage reviews. Each individual item is low risk (Levels 0–1 individually), but bundling them together raises blast radius (5 distinct file groups touched). The prompt-template reconciliation (Cluster E) is the highest-risk item because it edits the base worker prompt that governs every batch — that section deserves plan + code review even if the others could ship without. **Per-step reviews intended** (no checkpoint markers); each cluster is independent enough that per-step plan + code reviews give the most useful gating.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2 (refactor changes are reversible; prompt changes harder to roll back)

## Canonical Task Folder

```
taskplane-tasks/TP-189-polish-bundle/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Bundle of 8 small polish items that accumulated across TP-181, TP-184, TP-185, and TP-186 sage code reviews + the v0.28.5/v0.28.6 release work. None blocked their respective releases (all sage-rated as deferrable), so they were intentionally queued for a polish-bundle release rather than dragging individual hot-fix releases. Now is a good time to land them as a group, ahead of TP-187 + TP-188 (which are the next substantive bug-fix work).

The 8 items, grouped into 5 implementation clusters:

### Cluster A — Defensive tests + helper hardening (TP-184 + TP-186 follow-ups)

1. **Static-assertion test for `lane-runner.ts` spawn-site wiring** (TP-184 follow-up): asserts that `buildWorkerToolsAllowlist(config.workerTools)` is called at the worker spawn site. Sage flagged this in the TP-184 review as an architectural regression guard — if a future edit accidentally bypasses the helper, this test catches it before merge.
2. **Runtime refusal test for `review_step` guard** (TP-186 follow-up): mocks the spawn pathway, configures STATUS.md to show a step Complete, calls `review_step(type='code')`, and asserts: (a) returns the REFUSED payload with the documented text, (b) does NOT spawn a reviewer subprocess, (c) does NOT increment the review counter. Currently the guard's behavior is only validated via source-pattern tests; this adds end-to-end coverage.
3. **Fenced-code-block filter in `isStepMarkedComplete`** (TP-186 follow-up): currently the helper scans STATUS.md text line-by-line for `**Status:** ✅ Complete` patterns. If a literal `**Status:** ✅ Complete` appears inside a fenced code block in the body of a step (e.g., as documentation of the format), the helper would false-positive and refuse a legitimate review. Low-priority hardening: ignore fenced code blocks during the scan.

### Cluster B — Constants module migration (TP-184 follow-up)

4. **Migrate `DEFAULT_WORKER_USER_TOOLS` literal to a shared lightweight constants module**: currently the literal `"read,write,edit,bash,grep,find,ls"` is duplicated in `extensions/taskplane/config-schema.ts` (×2 sites) and `extensions/taskplane/types.ts`, with annotation comments pointing at `agent-host.ts` as the canonical source. The annotation was a deliberate compromise during TP-184 because importing `agent-host.ts` (which has heavy `child_process`/`fs` imports) into the schema/types layer would either be circular or pull I/O modules into pure-data files. Sage recommended a future cleanup: introduce a small `extensions/taskplane/tool-allowlist-constants.ts` (or similar) that both `agent-host.ts` and the schema/types modules can import without circularity. The shared module should have NO imports beyond TypeScript built-ins.

### Cluster C — Diagnostic UX fix (TP-185 follow-up)

5. **Fix `taskplane doctor` empty `pi installed ()` display**: pi prints its version string to **stderr**, but `bin/taskplane.mjs:131`'s `getVersion()` only reads stdout. Result: `taskplane doctor` shows `✅ pi installed ()` with empty parens because stderr is discarded. The fix: capture both streams and use stderr if stdout is empty (or merge them with stdout-precedence). 2-line fix in `bin/taskplane.mjs`. Verified manually during TP-185 work — pi DOES print version to stderr (`pi --version 2>&1 1>/dev/null` returns `0.73.x`).

### Cluster D — CI infrastructure alignment

6. **Migrate `.github/workflows/ci.yml` from Node 22 to Node 24**: `release.yml` was bumped to Node 24 LTS during the v0.28.5 release work (PR #544); `ci.yml` is still on Node 22. Aligning both reduces "works on release, fails on PR CI" surprises. Single-line change. Run a CI verification on the change itself before merging — Node 24 must still pass the existing test suite (it does locally on 24.15.0).

### Cluster E — Documentation / template polish (TP-186 follow-up + skill clarification)

7. **Reconcile older-prompt ambiguity in `templates/agents/task-worker.md`**: sage's TP-186 review noted that the new Order of Operations rule (review-gated step completion) coexists with older guidance about advancing when checkboxes are done — those don't strictly conflict but can create mental dissonance. The reconciliation: read through the relevant sections (search for "checkbox", "next step", "advance", "proceed", "STATUS.md") and either (a) rewrite older lines to align with the new rule, or (b) add cross-reference notes pointing at the new Order of Operations. **`⚠️ Hydrate`**: the specific ambiguities require runtime discovery — the worker should grep for the relevant patterns, identify each potentially conflicting section, and decide on per-section action.
8. **Document per-step vs. consolidated review pattern in `skills/create-taskplane-task/SKILL.md`**: the existing Review Level rubric describes Levels 0–3 but doesn't explicitly cover the "per-step (default) vs. consolidated-via-checkpoint-markers (opt-in)" axis. PROMPT authors discovered this empirically when watching TP-186's batch fire only 2 reviews (instead of one per implementation step) because TP-186's PROMPT used `**Plan-review checkpoint**` and `**Code review checkpoint**` markers to consolidate. Add a short paragraph or callout to the rubric making the choice explicit so future PROMPT authors deliberately opt in or out.

## Dependencies

- **TP-186** must be merged (it is — shipped in v0.28.6). Cluster A items 2 and 3 reference the `isStepMarkedComplete` helper added there.
- **TP-184** must be merged (it is — shipped in v0.28.5). Cluster A item 1 and Cluster B reference `buildWorkerToolsAllowlist` added there.
- **TP-185** must be merged (it is — shipped in v0.28.5). Cluster C is a follow-up to that fix.
- **No dependencies on TP-187 or TP-188** — those are independent later tasks.

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `taskplane-tasks/TP-181-merge-worker-model-from-preferences/STATUS.md` — sage findings that became Cluster A item 1 + Cluster B
- `taskplane-tasks/TP-184-worker-tool-allowlist-bridge-tools/STATUS.md` — sage findings that became Cluster A item 1 + Cluster B
- `taskplane-tasks/TP-186-worker-step-completion-protocol/STATUS.md` — sage findings that became Cluster A items 2-3 + Cluster E item 7
- `extensions/taskplane/agent-host.ts` — current `ENGINE_BRIDGE_TOOLS`, `DEFAULT_WORKER_USER_TOOLS`, `buildWorkerToolsAllowlist` exports (Cluster B references these)
- `extensions/taskplane/config-schema.ts` lines ~597 and ~649 — duplicated literals (Cluster B target sites)
- `extensions/taskplane/types.ts` line ~393 — duplicated literal (Cluster B target site)
- `extensions/taskplane/lane-runner.ts` line ~590 — spawn site for Cluster A item 1's regression guard
- `extensions/taskplane/agent-bridge-extension.ts` — `isStepMarkedComplete` helper + `review_step` guard (Cluster A items 2-3 target)
- `bin/taskplane.mjs` lines ~120 and ~131 — `commandExists` and `getVersion` functions (Cluster C target)
- `.github/workflows/ci.yml` line ~22 — `node-version: "22"` (Cluster D target)
- `.github/workflows/release.yml` lines ~58-67 — Node 24 setup pattern (model for Cluster D)
- `templates/agents/task-worker.md` — full file. Cluster E item 7 needs careful re-read of all sections referencing checkbox/step transitions.
- `skills/create-taskplane-task/SKILL.md` lines ~140-180 — Review Level rubric (Cluster E item 8 target)
- `extensions/tests/worker-tools-allowlist.test.ts` — sibling test file for Cluster A item 1's pattern
- `extensions/tests/worker-step-completion-protocol.test.ts` — sibling test file for Cluster A items 2 and 3

## Environment

- **Workspace:** `extensions/taskplane/` + `extensions/tests/` + `bin/` + `.github/workflows/` + `templates/agents/` + `skills/`
- **Services required:** None

## File Scope

Listed by cluster:

### Cluster A
- `extensions/tests/lane-runner-spawn-wiring.test.ts` (NEW, item 1) — static assertion that lane-runner spawn site uses the helper
- `extensions/tests/review-step-guard-runtime.test.ts` (NEW, item 2) — runtime test of the REFUSED path
- `extensions/taskplane/agent-bridge-extension.ts` (modified, item 3) — `isStepMarkedComplete` ignores fenced code blocks

### Cluster B
- `extensions/taskplane/tool-allowlist-constants.ts` (NEW, item 4) — single source of truth for the user-tools default literal
- `extensions/taskplane/agent-host.ts` (modified) — re-export from new module OR import from new module (decision in Step 0 preflight)
- `extensions/taskplane/config-schema.ts` (modified) — replace literals with import
- `extensions/taskplane/types.ts` (modified) — replace literal with import

### Cluster C
- `bin/taskplane.mjs` (modified) — `getVersion` captures both streams

### Cluster D
- `.github/workflows/ci.yml` (modified) — `node-version: "22"` → `"24"`

### Cluster E
- `templates/agents/task-worker.md` (modified) — reconcile older sections with TP-186's Order of Operations rule (`⚠️ Hydrate`: specific edits depend on what's found)
- `skills/create-taskplane-task/SKILL.md` (modified) — add per-step vs. consolidated review pattern documentation

### Documentation
- `CHANGELOG.md` — Unreleased / Internal entry (this is mostly internal polish; user-visible items are doctor display fix and prompt clarifications, those go in Fixed and Docs respectively)

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it.
>
> **⚠️ Order of Operations rule from TP-186 (now live):** do NOT mark a step
> `Complete` until that step's code review (this task is Review Level 2, so
> code reviews fire per step) has returned APPROVE.
>
> **Review structure:** this task uses **per-step reviews** (no checkpoint
> markers). Each implementation step (1-5) gets a plan review BEFORE
> implementation and a code review AFTER. That's 5 plan + 5 code = 10 reviews.
> The reviewer overhead is acceptable because the clusters are independent
> and per-cluster review feedback is more useful than a consolidated review
> across unrelated changes.

### Step 0: Preflight

- [ ] On a topic branch derived from main (e.g., `chore/tp-189-polish-bundle`)
- [ ] Working tree clean
- [ ] Baseline test count recorded: `cd extensions && npm run test:fast` — should show 3467+ post-v0.28.6
- [ ] Read all Tier 3 context files relevant to each cluster
- [ ] Decision in Discoveries: for Cluster B, will the new constants module export `DEFAULT_WORKER_USER_TOOLS` only, or also re-export `ENGINE_BRIDGE_TOOLS` for symmetry? (Recommended: only the literal that has the duplication problem; ENGINE_BRIDGE_TOOLS lives fine in agent-host.ts since that's where its consumers are anyway.)
- [ ] Decision in Discoveries: for Cluster D, run a smoke build of the test suite on Node 24 locally before bumping ci.yml? (Recommended: yes — `node --version` should already show 24.15.0 via mise, run the suite once and confirm zero new failures attributable to Node version.)

### Step 1: Cluster A — Defensive tests + helper hardening

- [ ] **Item 1**: Add `extensions/tests/lane-runner-spawn-wiring.test.ts`. Source-pattern test that asserts `buildWorkerToolsAllowlist(config.workerTools)` appears in `lane-runner.ts` near the spawn site (sufficient slice window to be future-proof; consider modeling on `lane-runner-v2.test.ts` test 3.6's structure but with a wider tolerance to avoid the brittleness that test had).
- [ ] **Item 2**: Add `extensions/tests/review-step-guard-runtime.test.ts`. Runtime test:
   - Set up a mock worktree with a STATUS.md that has Step 2 marked Complete
   - Mock the spawn-reviewer pathway (no actual subprocess)
   - Invoke the `review_step` handler with `step=2, type='code'`
   - Assert: returns object containing the REFUSED token, NO reviewer spawned, review counter NOT incremented
   - Repeat for `type='test'` (also blocked) and `type='plan'` (NOT blocked — sanity check)
- [ ] **Item 3**: Modify `isStepMarkedComplete` in `agent-bridge-extension.ts` to skip fenced code blocks during its scan. Strategy: track fence state with a boolean (toggle on lines matching `^```|^~~~`), only inspect non-fenced lines for the `**Status:** ✅ Complete` pattern. Add a unit test (in the existing `worker-step-completion-protocol.test.ts` or the new runtime test file) covering: literal Status pattern inside fenced block → guard returns false (legitimate review allowed); same pattern outside fence → guard returns true (refusal fires).
- [ ] Run targeted: the three new/updated test files pass

**Artifacts:**
- `extensions/tests/lane-runner-spawn-wiring.test.ts` (new)
- `extensions/tests/review-step-guard-runtime.test.ts` (new)
- `extensions/taskplane/agent-bridge-extension.ts` (modified — fenced-code filter in `isStepMarkedComplete`)
- `extensions/tests/worker-step-completion-protocol.test.ts` (possibly modified — add fenced-block test case if not in the new file)

### Step 2: Cluster B — Constants module migration

- [ ] Create `extensions/taskplane/tool-allowlist-constants.ts` exporting `DEFAULT_WORKER_USER_TOOLS = "read,write,edit,bash,grep,find,ls"`. Module must have NO imports (no `child_process`, no `fs`, nothing that would create circular import paths from schema/types modules).
- [ ] Update `extensions/taskplane/agent-host.ts` to import from the new module (and possibly re-export for backward compatibility if any external consumers reference `agent-host.ts`'s `DEFAULT_WORKER_USER_TOOLS` export — check first; if internal-only, no re-export needed)
- [ ] Update `extensions/taskplane/config-schema.ts` (line ~597 and ~649): replace the duplicated literal with an import + reference. Remove the annotation comment pointing at agent-host (now obsolete since the import is direct).
- [ ] Update `extensions/taskplane/types.ts` (line ~393): same.
- [ ] Verify no new circular imports introduced: `cd extensions && node --experimental-strip-types --no-warnings -e "await import('./taskplane/types.ts')"` should succeed without errors.
- [ ] Targeted tests pass: full fast suite runs unchanged (no behavior change, just refactoring).

**Artifacts:**
- `extensions/taskplane/tool-allowlist-constants.ts` (new)
- `extensions/taskplane/agent-host.ts` (modified — import or re-export)
- `extensions/taskplane/config-schema.ts` (modified)
- `extensions/taskplane/types.ts` (modified)

### Step 3: Cluster C — `taskplane doctor` empty pi version

- [ ] Modify `getVersion()` in `bin/taskplane.mjs` (line ~131) to capture both stdout and stderr. Strategy: pass `stdio: 'pipe'` (already done), and check both `stdout` and `stderr` from the result. If stdout is non-empty, use it; else fall back to stderr. Trim whitespace.
- [ ] Manual verification: `node bin/taskplane.mjs doctor` should now show `✅ pi installed (0.73.x)` (or whatever the actual pi version is).
- [ ] Add a small unit test (in a new `extensions/tests/cli-doctor-version-capture.test.ts` or similar) that mocks a child process printing to stderr and asserts `getVersion` returns the stderr content. NOTE: testing `bin/taskplane.mjs` (a `.mjs` file) may require special handling — alternative is to skip the test if it's awkward and rely on manual verification.

**Artifacts:**
- `bin/taskplane.mjs` (modified — `getVersion` captures stderr)
- `extensions/tests/cli-doctor-version-capture.test.ts` (new, OPTIONAL if testability is awkward)

### Step 4: Cluster D — CI Node 24 alignment

- [ ] Local verification BEFORE editing the workflow: `cd extensions && npm run test:fast` on local Node 24.x (already the active mise version per AGENTS.md). Should show 3467+ passing. This catches Node-version-specific breakage in advance.
- [ ] Edit `.github/workflows/ci.yml`: change `node-version: "22"` to `node-version: "24"`. Single-line change.
- [ ] Verify the change passes CI on the PR. If a new test failure surfaces that's specific to Node 24, investigate before merging — could indicate a real Node 24 incompatibility we missed.

**Artifacts:**
- `.github/workflows/ci.yml` (modified — node-version "22" → "24")

### Step 5: Cluster E — Worker prompt + skill reconciliation

> **`⚠️ Hydrate`**: this step's specific actions depend on what conflicting
> sections the worker discovers. The bullet checkboxes below are
> placeholder outcomes; the worker should expand them with concrete edits
> after the discovery pass.

- [ ] Discovery pass: grep `templates/agents/task-worker.md` for "checkbox", "next step", "advance", "proceed", "STATUS.md", "Complete" — read each match's surrounding context, identify any line that could conflict mentally with TP-186's "Workers MUST NOT mark a step `Status: ✅ Complete` before APPROVE" rule.
- [ ] For each conflicting line found, decide: (a) rewrite to align, (b) add a cross-reference note pointing at the Order of Operations rule, (c) leave as-is if the apparent conflict is actually fine in context. Document each decision in STATUS.md Discoveries.
- [ ] Apply the chosen edits.
- [ ] Item 8: in `skills/create-taskplane-task/SKILL.md`, add a new sub-section to the Review Levels documentation (around the existing rubric table, lines ~140-180) explaining the per-step vs. consolidated review pattern:
   - **Default behavior**: per-step plan + code reviews fire automatically based on Review Level
   - **Consolidation via checkpoint markers**: a PROMPT can include `**Plan-review checkpoint**` or `**Code review checkpoint**` markers in specific steps; the worker treats those as instructions to fire reviews at those steps only, instead of per-step
   - **When to use which**: per-step is the right default for multi-feature tasks where each step is an independent piece of work; consolidation is appropriate for single-deliverable tasks (e.g., "ship a single config change") where the steps are mechanical applications of one design
   - Reference TP-186 as a real example of consolidation (one prompt-design deliverable + 3 mechanical implementation steps + 1 code-review-everything step)

**Artifacts:**
- `templates/agents/task-worker.md` (modified — reconciliation edits per Discovery)
- `skills/create-taskplane-task/SKILL.md` (modified — review-pattern documentation)

### Step 6: Testing & Verification

> ZERO test failures allowed. Full quality gate.

- [ ] Run FULL fast suite: `cd extensions && npm run test:fast` — pass count should be baseline (3467) + new tests from Clusters A and C (3-5 new). No existing tests should regress.
- [ ] Run integration suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts tests/*.integration.test.ts`
- [ ] CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor` — verify Cluster C fix in action: pi version should now show in the doctor output.
- [ ] Verify Cluster B refactor introduced no circular imports (re-run the import probe from Step 2)
- [ ] Verify Cluster D CI change works on the PR's CI run

### Step 7: Documentation & Delivery

- [ ] Update `CHANGELOG.md` with one or more Unreleased entries:
   - **Internal** (not user-visible): Cluster A items 1-2, Cluster B (refactor), Cluster D (CI infra)
   - **Fixed** (user-visible): Cluster A item 3 (fenced-code-block edge case), Cluster C (doctor pi version)
   - **Docs** (user-visible): Cluster E (worker prompt clarifications, skill review-pattern documentation)
- [ ] Discoveries logged in STATUS.md (especially: which sections of `task-worker.md` were edited in Cluster E, and the rationale per edit)

## Documentation Requirements

**Must Update:**
- `CHANGELOG.md` — multiple entries grouped by category
- `templates/agents/task-worker.md` — Cluster E item 7 reconciliation (specific changes hydrated at runtime)
- `skills/create-taskplane-task/SKILL.md` — Cluster E item 8 review-pattern documentation

**Check If Affected:**
- `docs/reference/configuration/taskplane-settings.md` — Cluster B's constants module change might be worth a footnote if `taskRunner.worker.tools` documentation references the canonical default; otherwise no change.
- `docs/explanation/architecture.md` — Cluster B is internal refactoring; not user-facing. Likely no change.
- `extensions/taskplane/types.ts` JSDoc on `TaskRunnerConfig.worker` — verify the comment about "duplicated literal in this and config-schema.ts" is removed/updated as part of Cluster B (the duplication will be gone).

## Completion Criteria

- [ ] All 8 items implemented across the 5 clusters
- [ ] All new tests pass
- [ ] Full fast + integration suites passing
- [ ] No new circular imports introduced (Cluster B verification)
- [ ] `taskplane doctor` shows pi version (Cluster C verification)
- [ ] CI passes on the PR with Node 24 (Cluster D verification)
- [ ] Each Cluster E edit's rationale documented in Discoveries
- [ ] CHANGELOG entries categorized correctly (Internal vs. Fixed vs. Docs)

## Git Commit Convention

- **Step completion:** `chore(TP-189): complete Step N — description` (most clusters are internal/refactor, hence `chore`)
- **Per-cluster commits within a step:** `chore(TP-189-A1): static-assertion test for spawn-site wiring`, `refactor(TP-189-B): migrate DEFAULT_WORKER_USER_TOOLS to constants module`, `fix(TP-189-C): doctor pi-version reads stderr`, `chore(TP-189-D): ci.yml Node 22 → Node 24`, `docs(TP-189-E1): reconcile task-worker.md older sections with Order of Operations`, `docs(TP-189-E2): document per-step vs consolidated review pattern in SKILL.md`
- **Hydration:** `hydrate: TP-189 expand Step 5 checkboxes` (specifically for Cluster E's Discovery-pass results)

## Do NOT

- **Do not** widen Cluster B to migrate other duplicated literals in the codebase. The migration target is specifically the `DEFAULT_WORKER_USER_TOOLS` literal because sage flagged that one. Other duplications (if any) deserve their own scoped task.
- **Do not** edit the new Order of Operations / Recovery Recipe sections themselves in Cluster E. Those are TP-186's deliverable. Cluster E reconciles OLDER sections that were not updated when TP-186 added the new ones.
- **Do not** consolidate reviews via checkpoint markers in this task. The per-step review pattern is the deliberate choice — partly because each cluster is independent, partly because Cluster E's documentation work specifically describes per-step as the default.
- **Do not** widen Cluster C beyond the empty-pi-version display bug. There may be other `getVersion` quirks (e.g., what if the binary outputs nothing at all?) — those are out of scope for this task.
- **Do not** change ci.yml's other settings (Biome lint step, doctor smoke, etc.) in Cluster D. Only the node-version line.
- **Do not** push directly to main — branch + PR per AGENTS.md.

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
