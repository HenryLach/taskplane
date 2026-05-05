# Task: TP-184 - Always include engine bridge tools in worker `--tools` allowlist

**Created:** 2026-05-04
**Size:** S

## Review Level: 2 (Plan and Code)

**Assessment:** Touches the central worker-spawn code path used by every batch run. Introduces a new abstraction (single source of truth for engine-internal tool list, additive helper) that affects user-facing config semantics — `taskRunner.worker.tools` was previously dead config (TP-181 wired it through but the augmentation behavior is new). Plan + code review needed because the behavior change cascades through schema defaults, lane-runner spawn args, and tests in `lane-runner-v2.test.ts` that scan the spawn region for tool symbols.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-184-worker-tool-allowlist-bridge-tools/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix issue [#530](https://github.com/HenryLach/taskplane/issues/530): workers are launched with a hardcoded `--tools` allowlist (`read,write,edit,bash,grep,find,ls`) that omits the orchestrator's three engine-internal coordination tools: `review_step`, `notify_supervisor`, `request_segment_expansion`. Pi's tool gate then hides those tools from the worker, so the worker silently cannot:

- invoke `review_step` to spawn a reviewer at step boundaries (this means **plan/code/test reviews never fire at any Review Level ≥ 1**, despite the worker prompt explicitly instructing it to)
- reply to supervisor steering messages via `notify_supervisor`
- request runtime segment expansion via `request_segment_expansion`

The bridge tools are correctly registered by `agent-bridge-extension.ts` (lines 137, 230, 599) but the spawn-time `--tools` flag passed via `agent-host.ts:260` filters them out.

**TP-181 (just merged via PR #522) wired user's `taskRunner.worker.tools` from preferences through env vars, so the user-config plumbing now works.** What's still missing — and what this task fixes — is:

1. Bridge tools must be **always appended** to the worker allowlist, regardless of what the user configures, because they're engine-internal capabilities, not user options.
2. The literal `"read,write,edit,bash,grep,find,ls"` fallback string is duplicated in five places (execution.ts, lane-runner.ts, config-schema.ts ×2, types.ts) and must be deduplicated to a single source of truth so future drift is impossible.
3. A defensive sanity check should warn if any bridge tool ends up missing from the final allowlist (cheap insurance against this regressing again).

## Approach

Per the issue's preferred ("cleaner alternative") suggestion, introduce two named constants and one helper in a single module, then call the helper at the spawn site:

```ts
// extensions/taskplane/agent-host.ts (new exports near the top)

/**
 * Engine-internal tools that the orchestrator's bridge extension registers
 * for every worker. These are NOT user-configurable — they are always
 * appended to the worker's --tools allowlist regardless of taskRunner.worker.tools.
 *
 * If a worker is missing one of these tools, the matching feature silently
 * no-ops:
 *   - review_step:                plan/code/test reviews never fire
 *   - notify_supervisor:          worker cannot reply to supervisor steering
 *   - request_segment_expansion:  multi-repo segment expansion unreachable
 *
 * @since TP-184
 */
export const ENGINE_BRIDGE_TOOLS = [
  "review_step",
  "notify_supervisor",
  "request_segment_expansion",
] as const;

/**
 * Default user-tools portion of the worker allowlist. Engine bridge tools
 * are appended on top by buildWorkerToolsAllowlist().
 *
 * @since TP-184
 */
export const DEFAULT_WORKER_USER_TOOLS = "read,write,edit,bash,grep,find,ls";

/**
 * Build the final worker --tools allowlist string by combining the user-tools
 * portion (from config or default) with the engine bridge tools (always
 * appended, deduplicated).
 *
 * @since TP-184
 */
export function buildWorkerToolsAllowlist(userTools: string | undefined | null): string {
  const userPart = (userTools && userTools.trim()) || DEFAULT_WORKER_USER_TOOLS;
  const userList = userPart.split(",").map(s => s.trim()).filter(Boolean);
  const merged = new Set<string>(userList);
  for (const t of ENGINE_BRIDGE_TOOLS) merged.add(t);
  return Array.from(merged).join(",");
}
```

Then call this **exactly once**, at the lane-runner spawn site where `opts.tools` is constructed:

```diff
// extensions/taskplane/lane-runner.ts:580
- tools: config.workerTools || "read,write,edit,bash,grep,find,ls",
+ tools: buildWorkerToolsAllowlist(config.workerTools),
```

Keep `LaneRunnerConfig.workerTools` as the **user-intent** value (what the user configured, or the default). Augmentation happens at the spawn point only — this preserves a single, traceable layer of "user said X, engine added bridge tools".

The default in `execution.ts:2656` becomes `DEFAULT_WORKER_USER_TOOLS` (DRY) but does NOT include bridge tools — those are appended by the helper at the spawn site.

## Dependencies

- **None** (TP-181 already merged — its env-var plumbing is what makes user config flow this far)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `taskplane-tasks/TP-181-merge-worker-model-from-preferences/STATUS.md` — sibling task that just shipped; understand the env-var pipeline (`buildWorkerEnv` → `TASKPLANE_WORKER_TOOLS` → `LaneRunnerConfig.workerTools`) before touching anything.
- `extensions/taskplane/agent-host.ts` — current `--tools` arg construction (line 260) and where the new constants/helper will live.
- `extensions/taskplane/lane-runner.ts` — `LaneRunnerConfig` interface (line 199), the spawn options block (line 580). This is the **one place** where the helper gets called.
- `extensions/taskplane/execution.ts` — line 2656 where `workerTools` field of `laneRunnerConfig` is set from env vars; this becomes the default-using-the-named-constant change.
- `extensions/taskplane/agent-bridge-extension.ts` — bridge tool registrations at lines 137 (notify_supervisor), 230 (request_segment_expansion), 599 (review_step). **Do not modify these** — they're already correct. Just confirm they line up with `ENGINE_BRIDGE_TOOLS` exactly.
- `extensions/tests/worker-model.test.ts` — sibling test file from TP-181; use it as the structural model for the new `worker-tools-allowlist.test.ts`.
- `extensions/tests/lane-runner-v2.test.ts` — test 3.6 is brittle (5000-byte source-slice window). The TP-181 fix already widened it to 6000. **Verify** the helper-call change doesn't push tracked symbols past 6000; widen further if needed and document why.

## Environment

- **Workspace:** `extensions/taskplane/` + `extensions/tests/` + `docs/reference/configuration/`
- **Services required:** None

## File Scope

- `extensions/taskplane/agent-host.ts` — add `ENGINE_BRIDGE_TOOLS`, `DEFAULT_WORKER_USER_TOOLS`, `buildWorkerToolsAllowlist()` near the top (or in a new `tools-allowlist.ts` module if cleaner)
- `extensions/taskplane/lane-runner.ts` — line 580: replace literal with helper call
- `extensions/taskplane/execution.ts` — line 2656: import and use `DEFAULT_WORKER_USER_TOOLS` for the default; do NOT call the helper here
- `extensions/taskplane/config-schema.ts` — lines 597, 649: replace literal `"read,write,edit,bash,grep,find,ls"` with imported `DEFAULT_WORKER_USER_TOOLS` if it can be imported cleanly (check for circular-import risk first; if there's any concern, leave the literal in place with a comment pointing at the canonical constant)
- `extensions/taskplane/types.ts` — line 393: same DRY consideration as config-schema.ts (likely keep the literal here since types.ts often anchors module boundaries)
- `extensions/tests/worker-tools-allowlist.test.ts` (NEW) — unit tests for the helper, modeled on `worker-model.test.ts`
- `extensions/tests/lane-runner-v2.test.ts` — only if test 3.6's window needs further widening (verify first; widen with a comment if so)
- `docs/reference/configuration/taskplane-settings.md` — update the **Worker Tool Allowlist** section to clarify: user-tools-only, bridge tools always appended automatically
- `CHANGELOG.md` — Unreleased / Fixed entry

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it.

### Step 0: Preflight

- [ ] On `main`, working tree clean
- [ ] Baseline test pass: `cd extensions && npm run test:fast` — record pass count (should be 3420 after TP-181 merge)
- [ ] Read the Tier 3 source files above and confirm understanding before editing
- [ ] Verify `agent-bridge-extension.ts` registers exactly the three tool names that will be in `ENGINE_BRIDGE_TOOLS`: `notify_supervisor`, `request_segment_expansion`, `review_step` (no more, no less)
- [ ] Reproduce the bug in a synthetic test or by reading the run captured at `Emailgistics/emailgistics-astro` `orch/henrylach-20260504T210931` (per issue body) — confirm `events.jsonl` shows zero calls to bridge tools and `Review Counter` stayed at 0

### Step 1: Implement the helper and constants

- [ ] In `extensions/taskplane/agent-host.ts`, add `ENGINE_BRIDGE_TOOLS` (readonly tuple of three strings), `DEFAULT_WORKER_USER_TOOLS` (string constant), and `buildWorkerToolsAllowlist()` exported near the top of the file
- [ ] Helper semantics:
   - `null`/`undefined`/empty/whitespace input → fall back to `DEFAULT_WORKER_USER_TOOLS`
   - Non-empty input → split on `,`, trim entries, filter empty
   - Always append all three bridge tools, **deduplicated** (use `Set`)
   - Return value is a single comma-separated string (no leading/trailing commas, no spaces)
- [ ] Add JSDoc explaining: bridge tools are engine-internal, always appended, NOT user-configurable; what each bridge tool enables; consequences if missing
- [ ] Cross-reference issue #530 in the JSDoc

**Artifacts:**
- `extensions/taskplane/agent-host.ts` (modified — add constants and helper)

### Step 2: Wire the helper into the lane-runner spawn site

- [ ] In `extensions/taskplane/lane-runner.ts` line 580, import `buildWorkerToolsAllowlist` from `./agent-host.ts` and replace the literal-fallback expression with `buildWorkerToolsAllowlist(config.workerTools)`
- [ ] In `extensions/taskplane/execution.ts` line 2656, import `DEFAULT_WORKER_USER_TOOLS` and replace the literal `"read,write,edit,bash,grep,find,ls"` fallback with the named constant. **Do NOT** call `buildWorkerToolsAllowlist` here — augmentation happens once, at the lane-runner spawn site only.
- [ ] If `config-schema.ts` and `types.ts` literals can be replaced with `DEFAULT_WORKER_USER_TOOLS` without introducing circular imports (check the import graph), do so. Otherwise leave the literals with a comment pointing at the canonical constant.

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified)
- `extensions/taskplane/execution.ts` (modified)
- `extensions/taskplane/config-schema.ts` (modified — DRY only if safe)
- `extensions/taskplane/types.ts` (modified — DRY only if safe)

### Step 3: Add a defensive startup sanity check

- [ ] In `extensions/taskplane/lane-runner.ts`, immediately after the `tools:` field is set in `opts`, validate that the resulting comma-separated string contains every member of `ENGINE_BRIDGE_TOOLS`. If any is missing, emit a `WARN`-level `execLog` line: `WARN: workerTools allowlist missing engine bridge tool '<name>'; review/coordination features will silently no-op`
- [ ] This is defense-in-depth; under normal operation `buildWorkerToolsAllowlist` guarantees these are present. The warning catches future helper bugs or accidental bypasses.
- [ ] Do NOT throw or block spawn — log only.

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified — add validation)

### Step 4: Add unit tests

- [ ] Create `extensions/tests/worker-tools-allowlist.test.ts` modeled on `worker-model.test.ts` — same suite shape, same imports, same assertion style
- [ ] Tests for `buildWorkerToolsAllowlist`:
   1. `undefined` input → returns `DEFAULT_WORKER_USER_TOOLS` + bridge tools (in that order)
   2. `null` input → same as undefined
   3. Empty string input → same as undefined
   4. Whitespace-only string input → same as undefined
   5. Custom user tools (e.g. `"read,write"`) → returns user tools + bridge tools
   6. User tools that already include a bridge tool (e.g. `"read,write,review_step"`) → no duplication; bridge tool appears once
   7. User tools with extra whitespace and empty entries (e.g. `"read, ,write,"`) → trimmed and filtered before joining
   8. Result string has no leading/trailing commas, no spaces
- [ ] Tests for `ENGINE_BRIDGE_TOOLS`:
   1. Exactly three entries
   2. Entries are exactly: `review_step`, `notify_supervisor`, `request_segment_expansion`
   3. Match the names registered in `agent-bridge-extension.ts` (string-presence assertion, similar to lane-runner-v2 patterns)
- [ ] Run targeted: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/worker-tools-allowlist.test.ts`

**Artifacts:**
- `extensions/tests/worker-tools-allowlist.test.ts` (new)

### Step 5: Testing & Verification

> ZERO test failures allowed. Full quality gate before commit.

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts tests/*.integration.test.ts`
- [ ] Pass count must increase by the number of new tests added (~10–12)
- [ ] Specifically verify `lane-runner-v2.test.ts` test 3.6 still passes; if not, the helper-call line pushed `runGit(`/`commitTaskArtifacts(` past the 6000-byte window — widen further with a comment explaining why
- [ ] Specifically verify `worker-model.test.ts` (TP-181's tests) still passes — they test the env-var plumbing this task builds on top of
- [ ] CLI smoke: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`
- [ ] Manual sanity (optional but recommended): run TP-114 with `Review Level: 1` set in its STATUS.md and confirm a `.reviews/` directory is created with a verdict file. (Reverting Review Level afterward is fine.)

### Step 6: Documentation & Delivery

- [ ] Update `docs/reference/configuration/taskplane-settings.md` — find the **Worker Tool Allowlist** section. Clarify:
   - The configured tools list controls **user-facing tools** (file/shell/etc.) only
   - Engine bridge tools (`review_step`, `notify_supervisor`, `request_segment_expansion`) are **always appended automatically** and cannot be disabled via this config
   - Reference issue #530 in a footnote or "Why" callout if the doc style supports it
- [ ] Add `CHANGELOG.md` Unreleased / Fixed entry: "Workers can now invoke `review_step`, `notify_supervisor`, and `request_segment_expansion` (#530, TP-184). Previously these engine-internal coordination tools were missing from the worker's hardcoded `--tools` allowlist, so plan/code/test reviews silently never fired at Review Level ≥ 1. The bridge tools are now always appended to the worker allowlist regardless of `taskRunner.worker.tools` config; the user-tools default is unchanged."
- [ ] Discoveries logged in STATUS.md (especially: did the DRY changes in `config-schema.ts`/`types.ts` introduce circular imports? did test 3.6's window need re-widening? was there any wrinkle in the multi-segment / resume / mailbox interaction with the new tool list?)

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/taskplane-settings.md` — Worker Tool Allowlist section
- `CHANGELOG.md` — Unreleased / Fixed entry as described in Step 6

**Check If Affected:**
- `templates/agents/task-worker.md` — base prompt currently says "If you have access to a `review_step` tool" (lines 247–290). With this fix, the tool is reliably present, so the conditional wording invites future drift. **Do not modify in this task** — log as a follow-up in Discoveries; the wording can be tightened in a separate, low-risk doc change.
- `extensions/taskplane/settings-tui.ts:118` — the "Worker Tool Allowlist" TUI label is correct as-is (user controls user-tools); no change needed unless the help text needs to clarify bridge-tools augmentation.
- `extensions/taskplane/agent-bridge-extension.ts` — DO NOT modify. The bridge tool registrations are correct.

## Completion Criteria

- [ ] `buildWorkerToolsAllowlist` exists, is exported from `agent-host.ts`, and is called exactly once at the lane-runner spawn site (`lane-runner.ts:580`)
- [ ] All five literal `"read,write,edit,bash,grep,find,ls"` occurrences either replaced with the named constant or left in place with a comment pointing at the canonical constant (justified by circular-import concerns)
- [ ] All three bridge tools (`review_step`, `notify_supervisor`, `request_segment_expansion`) appear in the `--tools` allowlist passed to a spawned worker, regardless of user config
- [ ] User-supplied `taskRunner.worker.tools` is honored for the user-tools portion (file/shell capabilities); bridge tools are still always present
- [ ] Defensive sanity check warns (does NOT block) if a bridge tool is somehow missing
- [ ] New unit tests cover all cases listed in Step 4
- [ ] Full test suite passing
- [ ] CHANGELOG and config-reference docs updated

## Git Commit Convention

Commits happen at **step boundaries**. All commits MUST include the task ID:

- **Step completion:** `fix(TP-184): complete Step N — description`
- **Tests:** `test(TP-184): add worker-tools-allowlist unit tests`
- **Docs:** `docs(TP-184): clarify Worker Tool Allowlist + bridge tools in settings reference`
- **Hydration:** `hydrate: TP-184 expand Step N checkboxes`

## Do NOT

- **Do not** modify `agent-bridge-extension.ts` — bridge tool registrations are correct already
- **Do not** modify `agent-host.ts:260` (the `--tools` arg-passing line) — only ADD constants and helper near the top of the file
- **Do not** widen `agent-host.ts`'s scope to include reviewer or merger tool augmentation. The reviewer's allowlist (`agent-bridge-extension.ts:439`) is intentionally read-only and correct; the merger is unaffected
- **Do not** call `buildWorkerToolsAllowlist` more than once in the spawn pipeline — augmentation must be a single, idempotent layer (deduplicates if user happens to include a bridge tool, but should not be applied twice for safety)
- **Do not** change the user-tools default from `"read,write,edit,bash,grep,find,ls"` — that's a separate decision (the issue asks for a fix, not a default-tool-list rebalancing)
- **Do not** retighten the base prompt wording in `templates/agents/task-worker.md` — log as follow-up only
- **Do not** introduce a new `--tools` augmentation mechanism in pi itself; the fix is taskplane-side
- **Do not** push directly to `main` — branch + PR per AGENTS.md branching policy

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
