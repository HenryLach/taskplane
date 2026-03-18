# TP-023: `/orch-integrate` Command — Status

**Current Step:** Step 1: Register `/orch-integrate` Command
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 2
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
- [x] R002: Document state-lifetime contract (state deleted after clean completion) and design decision for /orch-integrate
- [x] R002: Map concrete test files for command registration/parsing and branch-safety
- [x] R002: Fix malformed review table and deduplicate execution log entries
- [x] R002: Document --merge + --pr conflict handling decision

---

### Step 1: Register `/orch-integrate` Command
**Status:** 🟨 In Progress

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
| **Legacy persisted state (`orchBranch === ""`)**: When orchBranch is empty, batch used legacy merge mode (merges directly into baseBranch). `/orch-integrate` should detect this and show helpful message. | Impl: explicit empty-string check | persistence.ts:377 |
| **State-lifetime contract (R002 critical)**: Engine deletes `batch-state.json` on clean completion (`phase === "completed"`) at engine.ts:825-828 and resume.ts:1468-1471. `/orch-abort` also deletes it (abort.ts:461). This means `/orch-integrate` cannot rely on `batch-state.json` existing when user wants to integrate. **Design decision**: `/orch-integrate` must accept the orch branch name as a CLI argument (e.g., `/orch-integrate orch/op-batchid`) as a fallback when state is gone. Additionally, the command can try `loadBatchState()` first and fall back to git branch inspection. The orch branch naming convention `orch/{opId}-{batchId}` is discoverable. For Step 2: (1) try loadBatchState → use orchBranch/baseBranch from state, (2) if null, check if user provided branch name arg, (3) if neither, list `orch/*` branches and suggest. | Design: branch name arg fallback + git discovery | engine.ts:825-828, resume.ts:1468-1471 |
| **Test file mapping (R002)**: Concrete test targets: (1) `extensions/tests/orch-pure-functions.test.ts` — add arg-parsing pure function tests if we extract parsing. (2) New file `extensions/tests/orch-integrate.test.ts` — test command-level logic: branch safety check, state-loading error paths, mode selection, --merge/--pr mutual exclusion. No existing extension command registration tests exist to extend. | Add in Step 4 | extensions/tests/ |
| **--merge + --pr mutual exclusion (R002)**: If user passes both `--merge` and `--pr`, command should reject with clear error: "Cannot use --merge and --pr together. Choose one integration mode." This makes Step 1 parsing deterministic. | Impl: reject in arg parsing | extension.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-18 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-18 16:31 | Task started | Extension-driven execution |
| 2026-03-18 16:31 | Step 0 started | Preflight |
| 2026-03-18 16:34 | Review R001 | plan Step 0: REVISE |
| 2026-03-18 16:35 | Worker iter 1 | done in 116s |
| 2026-03-18 16:38 | Review R002 | code Step 0: REVISE |
| 2026-03-18 16:40 | R002 revisions | Adding state-lifetime, test mapping, table fixes |
| 2026-03-18 16:41 | Worker iter 1 | done in 158s, ctx: 18%, tools: 27 |
| 2026-03-18 16:41 | Step 0 complete | Preflight |
| 2026-03-18 16:41 | Step 1 started | Register `/orch-integrate` Command |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
