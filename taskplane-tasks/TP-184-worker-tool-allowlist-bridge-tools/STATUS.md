# TP-184: Always include engine bridge tools in worker `--tools` allowlist — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-04
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main`, working tree clean
- [ ] Baseline test count recorded (should be 3420 after TP-181)
- [ ] Tier 3 source files read; spawn pipeline understood end-to-end
- [ ] `agent-bridge-extension.ts` confirmed to register exactly the three tools that will live in `ENGINE_BRIDGE_TOOLS`
- [ ] Bug reproduced (synthetic test OR review of the captured run from issue #530)

---

### Step 1: Implement the helper and constants
**Status:** ⬜ Not Started

- [ ] `ENGINE_BRIDGE_TOOLS` const exported from `agent-host.ts` (readonly 3-tuple)
- [ ] `DEFAULT_WORKER_USER_TOOLS` const exported from `agent-host.ts`
- [ ] `buildWorkerToolsAllowlist(userTools)` helper exported, with semantics:
   - falsy/empty/whitespace input → fall back to default user tools
   - non-empty input → split, trim, filter, dedupe
   - always append bridge tools (deduped via `Set`)
- [ ] JSDoc with `@since TP-184` and reference to issue #530

---

### Step 2: Wire the helper into the lane-runner spawn site
**Status:** ⬜ Not Started

- [ ] `lane-runner.ts:580` calls `buildWorkerToolsAllowlist(config.workerTools)`
- [ ] `execution.ts:2656` uses `DEFAULT_WORKER_USER_TOOLS` for default (does NOT call the helper)
- [ ] `config-schema.ts` and `types.ts` literals deduped via constant import IF safe (no circular imports); else commented to point at the canonical constant
- [ ] No double-augmentation anywhere in the spawn pipeline

---

### Step 3: Add a defensive startup sanity check
**Status:** ⬜ Not Started

- [ ] Validation runs immediately after `opts.tools` is set in lane-runner
- [ ] Missing bridge tool emits `WARN`-level `execLog` line; does NOT throw or block spawn
- [ ] Warning text identifies the missing tool by name

---

### Step 4: Add unit tests
**Status:** ⬜ Not Started

- [ ] `extensions/tests/worker-tools-allowlist.test.ts` created modeled on `worker-model.test.ts`
- [ ] All 8 helper-behavior cases covered (undefined/null/empty/whitespace/custom/already-includes-bridge/whitespace-and-empty-entries/output-format)
- [ ] All 3 `ENGINE_BRIDGE_TOOLS` shape cases covered (count, exact entries, alignment with `agent-bridge-extension.ts`)
- [ ] Targeted run passes

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast + integration suite passing
- [ ] Pass count = baseline + new tests
- [ ] `lane-runner-v2.test.ts` test 3.6 still passes (window may need re-widening — record decision)
- [ ] `worker-model.test.ts` (TP-181) still passes
- [ ] CLI smoke clean
- [ ] Optional manual sanity: TP-114 with `Review Level: 1` produces `.reviews/` and a verdict file

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] `taskplane-settings.md` Worker Tool Allowlist section clarifies user-tools-only + always-appended bridge tools
- [ ] `CHANGELOG.md` Unreleased / Fixed entry added (#530, TP-184)
- [ ] Discoveries logged below
- [ ] Branch + PR opened per AGENTS.md branching policy

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-05-04 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

- Issue #530 was filed by an agent in the `Emailgistics/emailgistics-astro` project after observing zero `review_step` calls in a Review-Level-1 batch run.
- This task builds directly on TP-181 (PR #522) which wired `taskRunner.worker.tools` from preferences through env vars. The user-config plumbing is already in place; this task adds the always-append-bridge-tools layer on top.
- The base prompt at `templates/agents/task-worker.md` says "If you have access to a `review_step` tool" — that conditional was the only thing keeping this from being a hard prompt contradiction. After this fix, the tool is reliably present. Tightening the wording is intentionally deferred to a follow-up so this task stays scoped to the wiring fix.
