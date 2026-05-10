# TP-194: Code-quality gates flip — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ Order of Operations rule (live in worker prompt):** do NOT mark a step
> `Complete` until that step's code review has returned APPROVE. This task
> is Review Level 2 — per-step plan + code reviews fire automatically.
>
> **Review structure:** per-step reviews. Expected: ~5 plan + ~5 code = ~10
> reviews total.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] On `main` (lane worktree, fresh from TP-191 + TP-192 + TP-193 merges)
- [x] TP-191, TP-192, TP-193 confirmed merged (git log shows TP-191/192/193/195 all merged via PRs #569/#571/#572/#573; HEAD at fda753fb)
- [x] **CRITICAL pre-condition** — all three gates already pass on main BEFORE this task's changes:
  - [x] `npm run typecheck` exits 0
  - [x] `npm run lint` exits 0 (280 warnings + 671 infos, 0 errors)
  - [x] `npm run format:check` exits 0
- [x] Baseline test count recorded: 3628 tests, 3627 pass, 1 skipped, 0 fail
- [x] All Tier 3 context files read

---

### Step 1: Plan the gate flip
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint.

- [ ] Part 1 design (CI workflow structure: separate steps vs matrix)
- [ ] Part 2 design (workflow ordering: typecheck → lint → format:check → tests)
- [ ] Part 3 design (reviewer prompt diff to remove TP-191 activation note)
- [ ] Part 4 design (documentation updates per file)
- [ ] Part 5 design (branch protection list for operator handoff)
- [ ] Drafts in Discoveries

---

### Step 2: Implement Part 1 — CI workflow updates
**Status:** ⬜ Not Started

> Plan-reviewer must have APPROVED Step 1 before proceeding.
> ⚠️ Code-review fires after this step.

- [ ] `Typecheck` step added to ci.yml (no `continue-on-error`)
- [ ] `Lint (Biome)` step `continue-on-error: true` removed
- [ ] `Format check (Biome)` step added (no `continue-on-error`)
- [ ] Order verified: typecheck → lint → format:check → tests
- [ ] YAML syntax validates

---

### Step 3: Implement Part 2 — activate reviewer downgrade rule
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] Temporary activation note removed from `templates/agents/task-reviewer.md`
- [ ] TP-188 Quality-check verification section returns to fully-active form

---

### Step 4: Implement Parts 3-4 — documentation
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step.

- [ ] `AGENTS.md` validation checklist augmented with the three commands
- [ ] `docs/maintainers/release-process.md` pre-release checklist augmented
- [ ] `docs/maintainers/development-setup.md` documents the gate commands
- [ ] Cross-reference checks (no other docs reference legacy gate behavior)

---

### Step 5: Branch protection (operator handoff)
**Status:** ⬜ Not Started

- [ ] Required-status-check names documented in Discoveries (Typecheck, Lint (Biome), Format check (Biome) + existing checks)
- [ ] PR body references the operator handoff so it isn't forgotten

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passes (3624+)
- [ ] FULL integration suite passes
- [ ] `npm run typecheck` exits 0
- [ ] `npm run lint` exits 0
- [ ] `npm run format:check` exits 0
- [ ] CLI smoke clean
- [ ] Manual reviewer-agent smoke: planted typecheck error triggers REVISE downgrade

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entry under [Unreleased] → Internal added
- [ ] Discoveries logged below (manual reviewer smoke result, any deviations)
- [ ] All commits include `TP-194` prefix

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
| 2026-05-10 21:49 | Task started | Runtime V2 lane-runner execution |
| 2026-05-10 21:49 | Step 0 started | Preflight |

---

## Blockers

*None unless Step 0's CRITICAL pre-condition check fails*

---

## Notes

**The pre-condition check in Step 0 is the most important guardrail in the entire spec.** If `npm run typecheck` / `lint` / `format:check` don't all exit 0 on the fresh main BEFORE this task's changes, the gate flip will break the build. STOP and escalate to operator. The fix belongs in a follow-up to whichever precursor task introduced the failure (TP-191's tooling, TP-192's lint baseline, or TP-193's format pass).

**Branch protection is operator-only.** This task documents the handoff in Discoveries — it does NOT execute it. The operator updates branch protection via GitHub repo settings after this PR merges. The PR body must explicitly call this out.

**Manual reviewer smoke in Step 6:** the spec calls for a smoke test where a planted typecheck error triggers REVISE. This can be:
1. A throwaway TypeScript file with an obvious error (e.g., `let x: number = "string"`) staged in a temp branch
2. Run a one-task batch with the reviewer triggering on it
3. Confirm the reviewer's output downgrades APPROVE to REVISE with the typecheck error in Issues Found
4. Throw away the throwaway branch

This is Discoveries-only documentation, not a new automated test. The TP-188 source-pattern tests already verify the downgrade rule is wired; the manual smoke confirms it fires end-to-end with the activation now live.
