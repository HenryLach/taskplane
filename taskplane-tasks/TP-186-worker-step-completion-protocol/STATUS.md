# TP-186: Fix worker death-spiral via explicit step-completion protocol — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-06
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ This task IS the death-spiral fix.** Per its own future-state ordering
> rule, do NOT mark any step `Complete` until that step's code review (if at
> Review Level ≥ 2) has returned APPROVE. While running this task, the worker
> is still vulnerable to the bug being fixed — proceed carefully.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (lane worktree)
- [ ] Baseline test count recorded (post-v0.28.5: should be 3452+)
- [ ] All Tier 3 context files read
- [ ] Issues #537, #542, #510 read in full
- [ ] Decision recorded in Discoveries: Option A only OR Option A + Option B (default: A + B)

---

### Step 1: Plan the prompt edits and decide on Option B scope
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint. Reviewer evaluates wording before implementation.

- [ ] Order of Operations section drafted (5–6 step numbered sequence)
- [ ] Recovery Recipe drafted (revert + commit + handle REVISE through normal recipe)
- [ ] Forbidden callout drafted (matches existing "Workers MUST NOT" rule style)
- [ ] (If Option B) Guard inspection logic + refusal message designed; consistent with Recovery Recipe wording
- [ ] Drafts written into STATUS or scratch file for plan review

---

### Step 2: Apply prompt edits to templates/agents/task-worker.md
**Status:** ⬜ Not Started

- [ ] Order of Operations section inserted
- [ ] Recovery Recipe section inserted
- [ ] Forbidden callout inserted
- [ ] No internal contradictions with existing prompt content

---

### Step 3: (Optional) Implement Option B engine-side guard
**Status:** ⬜ Not Started

- [ ] STATUS.md inspection helper added (only if pursuing Option B)
- [ ] Wired into `review_step` handler in agent-bridge-extension.ts
- [ ] Applied to `code` and `test` types only (NOT `plan`)
- [ ] Refusal message matches Recovery Recipe verbatim

---

### Step 4: Add tests
**Status:** ⬜ Not Started

- [ ] `worker-step-completion-protocol.test.ts` created
- [ ] Source-pattern tests for the 3 prompt additions
- [ ] (If Option B) Behavioral tests for the guard
- [ ] Targeted run passes

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passing (count = baseline + new tests)
- [ ] Integration suite passing
- [ ] CLI smoke clean
- [ ] Code-review checkpoint: call `review_step(step=5, type='code', baseline=<sha>)`
- [ ] Per the new rule: do NOT mark Step 2 Complete until code review APPROVE

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG.md Unreleased / Fixed entry added (#537, #542)
- [ ] Comment on issue #510 noting supersession (don't close)
- [ ] Discoveries logged

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
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

- This task ships in v0.28.6 alone (per supervisor recommendation) so the
  death-spiral fix can be validated in production before subsequent recovery-UX
  work (TP-187, TP-188) lands.
- The worker running this task is itself vulnerable to the bug being fixed.
  Defense: Step 1 plan-review checkpoint catches wording issues early; the
  task is small enough that the worker shouldn't accumulate the long
  multi-step state where the bug bites.
