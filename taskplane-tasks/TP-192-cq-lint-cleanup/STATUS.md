# TP-192: Code-quality lint cleanup — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-10
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand step 2 with one checkbox per affected file after
> reading TP-191's lint inventory in Step 0.
>
> **⚠️ Order of Operations rule (live in worker prompt):** do NOT mark a step
> `Complete` until that step's review (plan or code as applicable) has
> returned APPROVE. This task is Review Level 1 — plan review fires after
> Step 1, and a single code review fires after Step 2 (the cleanup itself).

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (lane worktree, fresh from TP-191 merge)
- [ ] TP-191 confirmed merged (`npm run lint` script exists; Biome pinned in `devDependencies`)
- [ ] TP-191 STATUS.md Discoveries read for the lint inventory
- [ ] Baseline test count recorded (target: 3624+ passing post-TP-190/TP-191)
- [ ] `npm run lint` re-run; final inventory recorded in Discoveries below

---

### Step 1: Plan the cleanup strategy per error category
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint.

- [ ] Each error categorized (auto-fixable / mechanical-but-manual / needs-thought)
- [ ] Per-category fix approach documented in Discoveries
- [ ] Step 2 checkboxes hydrated with one item per affected file
- [ ] Suppression decision recorded (default: NO suppression)

---

### Step 2: Apply fixes by category
**Status:** ⬜ Not Started

> ⚠️ Code-review fires after this step (the only code review for this task).

> ⚠️ Hydrate: expand checkboxes with one item per affected file based on
> Step 0's inventory. Group by rule category for reviewer clarity.

- [ ] Auto-fixable group: `biome check --write` applied; mechanical diff verified
- [ ] Mechanical-but-manual group: each error hand-edited per rule
- [ ] Targeted tests pass for each modified file
- [ ] `npm run lint` exits 0
- [ ] Full fast suite passes

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passes (3624+ passing / 1 skipped / 0 failed)
- [ ] FULL integration suite passes
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` count unchanged or smaller
- [ ] `npm run format:check` exit status unchanged (formatter still disabled)
- [ ] CLI smoke clean

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG entry under [Unreleased] → Internal added
- [ ] Discoveries logged below
- [ ] All commits include `TP-192` prefix; grouped by rule category

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

*None*

---

## Notes

**Hydration approach for Step 2:** read TP-191's actual inventory (not the
expected list in this PROMPT). The expected list is based on recent CI logs
and may have shifted by the time TP-191 ships its inventory. Use TP-191's
authoritative count.

**Suppression policy:** if mid-cleanup the worker discovers an error that
genuinely cannot be fixed without an architectural change (e.g., `noRedeclare`
on something that's structurally required to be redeclared), STOP and
escalate to the operator via STATUS.md Discoveries rather than adding a
`// biome-ignore` comment. The operator will decide whether to approve a
suppression or expand scope.
