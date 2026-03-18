# TP-023: `/orch-integrate` Command — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `extension.ts` — command registration patterns
- [x] Read `persistence.ts` — batch state loading
- [x] Read `git.ts` — git helpers
- [x] Verify TP-022 artifacts present
- [x] R001: Document TP-022 invariants, failure modes, and test intent in Discoveries

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
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| **TP-022 orchBranch wiring**: `orchBranch` field exists on `OrchBatchRuntimeState` (types.ts:836) and `PersistedBatchState` (types.ts:1377). Engine creates branch at engine.ts:192-203 (`orch/{opId}-{batchId}`), assigns `batchState.orchBranch` at engine.ts:202. Serialized by `serializeBatchState()` at persistence.ts:786. Backward-compatible defaulting at persistence.ts:369-378: `orchBranch` defaults to `""` if absent from persisted JSON. | Confirmed present | types.ts, engine.ts, persistence.ts |
| **loadBatchState() failure modes**: Can throw `StateFileError` with codes `STATE_FILE_IO_ERROR`, `STATE_FILE_PARSE_ERROR`, `STATE_SCHEMA_INVALID` (persistence.ts:899-927). Returns `null` if file missing. `/orch-integrate` must catch all three error cases + null. | Impl: wrap in try/catch, user-facing error for each case | persistence.ts:899-927 |
| **getCurrentBranch() returns null on detached HEAD** (git.ts:18-22). `/orch-integrate` must handle null (show "detached HEAD" error, suggest checking out a branch). | Impl: null check before safety comparison | git.ts:18-22 |
| **Command registration pattern**: All commands use `pi.registerCommand(name, { description, handler })`. Args parsed via simple string matching (regex/includes). Guard with `requireExecCtx(ctx)` for commands needing workspace context. | Follow pattern | extension.ts:96-650 |
| **Session-start command list** at extension.ts:712-722 currently omits `/orch-integrate`. Step 1 should add it for operator visibility. | Update in Step 1 | extension.ts:712-722 |
| **Test impact**: No existing structural command-list assertions found in test suites. Extension tests focus on config/workspace. New tests needed for: command registration, arg parsing (--merge/--pr/--force), branch safety check logic, error messages. | Add tests in Step 4 | extensions/tests/ |
| **Legacy persisted state (`orchBranch === ""`)**: When orchBranch is empty, batch used legacy merge mode (merges directly into baseBranch). `/orch-integrate` should detect this and show helpful message. | Impl: explicit empty-string check | persistence.ts:377 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-18 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-18 16:31 | Task started | Extension-driven execution |
| 2026-03-18 16:31 | Step 0 started | Preflight |
| 2026-03-18 16:31 | Task started | Extension-driven execution |
| 2026-03-18 16:31 | Step 0 started | Preflight |
| 2026-03-18 16:34 | Review R001 | plan Step 0: REVISE |
| 2026-03-18 16:34 | Review R001 | plan Step 0: REVISE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
