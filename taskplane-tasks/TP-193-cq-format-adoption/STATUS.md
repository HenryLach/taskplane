# TP-193: Code-quality formatter adoption — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-10
**Review Level:** 0 (None)
**Review Counter:** 0
**Iteration:** 0
**Size:** S (mechanically L)

> **Hydration:** This task is a mechanical pass — STATUS.md tracks outcomes
> at the per-step level, not per-file.
>
> **Review Level 0:** No plan or code reviews fire. Reviewer-agent quality
> checks (typecheck/lint/format:check) MAY fire if reviewer is invoked
> during step transitions, but no formal review verdicts are required.
> The test suite is the correctness gate; operator coordination on the
> freeze window is the procedural gate.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (lane worktree, fresh from TP-191 + TP-192 merges)
- [ ] TP-191 + TP-192 confirmed merged (`npm run lint` exits 0; `npm run format:check` exits non-zero)
- [ ] **Operator freeze-window confirmation captured in Discoveries** (CRITICAL gate)
- [ ] Baseline test count recorded (3624+ passing)

---

### Step 1: Configure formatter rules in biome.json
**Status:** ⬜ Not Started

- [ ] `biome.json` formatter block updated per spec 6.3.1
- [ ] `javascript.formatter` block updated per spec 6.3.1
- [ ] `npm run format:check` reports many files needing formatting (sanity)
- [ ] Commit: `chore(TP-193): configure Biome formatter rules`

---

### Step 2: Apply biome format --write across the codebase
**Status:** ⬜ Not Started

- [ ] `npm run format` applied
- [ ] Sample diff inspection confirms purely mechanical changes (no logic)
- [ ] Full fast suite passes
- [ ] Single commit captures the format pass; SHA recorded in Discoveries
- [ ] Commit message: `chore(TP-193): apply biome format --write to entire codebase (formatter adoption)`

---

### Step 3: Add .git-blame-ignore-revs
**Status:** ⬜ Not Started

- [ ] `.git-blame-ignore-revs` created with Step 2 commit SHA + explanatory comment
- [ ] `git blame --ignore-revs-file=.git-blame-ignore-revs <file>` verified to skip the format commit
- [ ] Commit: `chore(TP-193): add format-adoption commit to .git-blame-ignore-revs`

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] `docs/maintainers/development-setup.md` updated with `.git-blame-ignore-revs` setup section
- [ ] CHANGELOG entry under [Unreleased] → Internal added
- [ ] Discoveries logged below (file count, rule choices, any conflicts)

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passes (3624+)
- [ ] FULL integration suite passes
- [ ] `npm run format:check` exits 0
- [ ] `npm run lint` exits 0 (TP-192 cleanup preserved)
- [ ] `npm run typecheck` count unchanged from TP-192 baseline
- [ ] CLI smoke clean

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
| 2026-05-10 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None unless freeze-window not confirmed in Step 0*

---

## Notes

**Operator coordination is the actual gating concern**, not technical complexity. The diff is mechanically simple (Biome generates it) but socially complex (every in-flight PR will need to rebase). Step 0's freeze-window check exists to prevent landing this task during active PR development.

**Freeze window protocol (per spec section 6.3.4):**
1. Operator announces a freeze 24h in advance.
2. All PRs at "ready to merge" are held — no new merges during the window.
3. TP-193 lands.
4. Held PRs rebase against the now-formatted main; Biome's formatter runs cleanly on rebased work, so the rebase is mechanical.
5. After TP-194 lands (the gate flip), `format:check` is required, and any new PR's format diff is a single review concern instead of an unbounded one.
