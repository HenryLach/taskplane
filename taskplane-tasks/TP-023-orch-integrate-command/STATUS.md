# TP-023: `/orch-integrate` Command — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** 🟡 In Progress

- [x] Read `extension.ts` — command registration patterns
- [x] Read `persistence.ts` — batch state loading
- [x] Read `git.ts` — git helpers
- [x] Verify TP-022 artifacts present
- [x] R001: Document TP-022 invariants, failure modes, and test intent in Discoveries
- [ ] R002: Document state-lifetime contract for completed batches and design decision for `/orch-integrate`
- [ ] R002: Name specific test files/suites for Step 4
- [ ] R002: Fix Reviews table formatting and Execution log duplicates
- [ ] R002: Revert out-of-scope TP-022 artifact edits

---

### Step 1: Register `/orch-integrate` Command
**Status:** ⬜ Not Started

- [ ] Register command with args parsing (--merge, --pr, --force)
- [ ] Set command description

---

### Step 2: Implement Integration Logic
**Status:** ⬜ Not Started

- [ ] Load and validate batch state
- [ ] Branch safety check (current vs baseBranch)
- [ ] Pre-integration summary

---

### Step 3: Implement Integration Modes
**Status:** ⬜ Not Started

- [ ] Fast-forward (default)
- [ ] Real merge (--merge)
- [ ] PR mode (--pr)
- [ ] Cleanup on success (delete orch branch, clean state)
- [ ] Success summary

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit tests passing
- [ ] Command parsing verified
- [ ] Branch safety verified
- [ ] Error messages verified
- [ ] All failures fixed

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| **TP-022 orchBranch wiring**: `orchBranch` field exists on `OrchBatchRuntimeState` (types.ts:836) and `PersistedBatchState` (types.ts:1377). Engine creates branch at engine.ts:192-203 (`orch/{opId}-{batchId}`), assigns `batchState.orchBranch` at engine.ts:202. Serialized by `serializeBatchState()` at persistence.ts:786. Backward-compatible defaulting at persistence.ts:369-378: `orchBranch` defaults to `""` if absent from persisted JSON. | Confirmed present | types.ts, engine.ts, persistence.ts |
| **loadBatchState() failure modes**: Can throw `StateFileError` with codes `STATE_FILE_IO_ERROR`, `STATE_FILE_PARSE_ERROR`, `STATE_SCHEMA_INVALID` (persistence.ts:899-927). Returns `null` if file missing. `/orch-integrate` must catch all three error cases + null. | Impl: wrap in try/catch, user-facing error for each case | persistence.ts:899-927 |
| **getCurrentBranch() returns null on detached HEAD** (git.ts:18-22). `/orch-integrate` must handle null (show "detached HEAD" error, suggest checking out a branch). | Impl: null check before safety comparison | git.ts:18-22 |
| **Command registration pattern**: All commands use `pi.registerCommand(name, { description, handler })`. Args parsed via simple string matching (regex/includes). Guard with `requireExecCtx(ctx)` for commands needing workspace context. | Follow pattern | extension.ts:96-650 |
| **Session-start command list** at extension.ts:712-722 currently omits `/orch-integrate`. Step 1 should add it for operator visibility. | Update in Step 1 | extension.ts:712-722 |
| **Test targets**: `workspace-config.test.ts` has command guard assertions (requireExecCtx at lines 681-698, 748-756). `orch-pure-functions.test.ts` tests pure helpers. New `/orch-integrate` tests should go in a new file `orch-integrate.test.ts` covering: command registration, arg parsing (--merge/--pr/--force, mutual exclusivity), branch safety check logic, error messages for missing state/wrong phase/empty orchBranch/detached HEAD. | Add tests in Step 4 | extensions/tests/orch-integrate.test.ts |
| **Legacy persisted state (`orchBranch === ""`)**: When orchBranch is empty, batch used legacy merge mode (merges directly into baseBranch). `/orch-integrate` should detect this and show helpful message. | Impl: explicit empty-string check | persistence.ts:377 |
| **State-lifetime contract — completed batches**: Engine deletes `batch-state.json` on clean completion (`phase === "completed"`, engine.ts:825-828, resume.ts:1468-1471). State is preserved only for `phase === "failed"`. This means `/orch-integrate` **cannot rely on persisted state for successful batches**. Design decision: the command must accept an explicit branch argument (`/orch-integrate orch/opId-batchId`) when state is absent, OR we must change the engine to preserve state when `integration !== "auto"`. **Chosen approach**: (1) if state file exists (failed batch or pre-cleanup), use it; (2) if state file is absent, require the user to pass the orch branch name explicitly (the completion message already displays it); (3) infer baseBranch from current branch when state is absent. This avoids modifying engine behavior (out of scope for TP-023) while keeping the command functional. | Design decision: dual-path (state or explicit branch arg) | engine.ts:825, resume.ts:1468 |
| **Preflight behavior matrix**: Missing state → require explicit branch arg or show error with guidance. Schema-invalid state → show parse error, suggest re-running /orch. Detached HEAD → show "detached HEAD" error, suggest git checkout. Legacy orchBranch==="" → show "already merged into baseBranch" message. Wrong branch + no --force → show warning with suggested branch switch. --merge + --pr conflict → show mutual exclusivity error. | Impl: validate in Step 2 handler | extension.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-18 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-18 16:31 | Task started | Extension-driven execution |
| 2026-03-18 16:31 | Step 0 started | Preflight |
| 2026-03-18 16:34 | Review R001 | plan Step 0: REVISE |
| 2026-03-18 16:35 | Worker iter 1 | done in 116s, ctx: 24%, tools: 24 |
| 2026-03-18 16:38 | Review R002 | code Step 0: REVISE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
