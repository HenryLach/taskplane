# TP-186 — Plan-Review Draft

This file is the input for the Step 1 plan review. It contains the
proposed wording for the three new sections that will be inserted into
`templates/agents/task-worker.md`, plus the design of the Option B
engine-side guard.

The goal of this fix is to eliminate the **worker death-spiral** described in
issue #537: a worker that marks a step `[x]` Complete in STATUS.md, commits,
and then receives a `REVISE` verdict from the code reviewer enters an
unresolvable contradiction (STATUS says done, reviewer says not), spins
through 3 no-progress iterations, and gets killed by the orch — the entire
batch is a write-off.

The fix is structural, not vibes: make the order-of-operations contract
**explicit** in the worker prompt, and provide a **recovery recipe** for
the case when the contract is accidentally violated.

---

## A. Order of Operations (insertion target: `Review Protocol` section, just before the existing "Example flow" subsection)

> ### ⚠️ MANDATORY: Order of Operations for Steps With Code Review
>
> **For any step that requires a code review (Review Level ≥ 2), the
> following order is MANDATORY. Workers MUST NOT mark a step Complete in
> STATUS.md before the code review has returned APPROVE.**
>
> 1. **Implement** the step's checkbox items (write code, edit docs, etc.)
>    — check each box `[x]` in STATUS.md as you finish that item, but
>    leave the **step's `Status:` heading** as `🟨 In Progress`.
> 2. **Commit** the implementation:
>    `git add -A && git commit -m "feat(TASK-ID): step N implementation"`
> 3. **Call** `review_step(step=N, type="code", baseline=<sha>)`.
> 4. If the verdict is **REVISE**: read the review file in `.reviews/`,
>    apply the fixes, commit them, and call `review_step` again.
>    Repeat until APPROVE (max 2 cycles).
> 5. If the verdict is **APPROVE**: NOW update the step's `Status:`
>    heading to `✅ Complete` in STATUS.md and commit the status update.
> 6. **Move to step N+1.**
>
> The key invariant: **`Status: ✅ Complete` is the worker's commitment
> that the reviewer has signed off.** It is not an in-progress marker.
> Setting it before APPROVE creates a contradiction the worker cannot
> recover from on its own.
>
> Individual checkboxes (`- [x] item text`) inside the step MAY be
> checked while implementation is in flight — they record per-item
> progress. The **step-level `Status:` heading** is the only field
> governed by this rule.

## B. Recovery Recipe (insertion target: immediately after the Order of Operations section above)

> ### Recovery: "I marked the step Complete, then the reviewer returned REVISE"
>
> If you violated the Order of Operations and set `Status: ✅ Complete`
> for a step before the code review returned APPROVE, **you can recover
> without operator intervention**. Follow this recipe exactly:
>
> 1. **Revert STATUS.md** for the affected step:
>    - Change the step's `**Status:** ✅ Complete` heading back to
>      `**Status:** 🟨 In Progress`.
>    - Leave the individual `- [x]` checkboxes alone — they record real
>      work that was done.
>    - If the top-of-file `**Current Step:**` field was advanced past this
>      step, set it back to this step's name.
> 2. **Commit** the revert with a dedicated message:
>    `git commit -am "chore(TASK-ID): revert premature step-N completion"`
> 3. **Handle the REVISE through the normal recipe:** read the review
>    file in `.reviews/`, add Issues-Found items as new checkboxes inside
>    the step (using the standard "After a REVISE Review" flow), commit
>    those hydration changes, fix the issues, commit the fixes, then call
>    `review_step(step=N, type="code")` again.
> 4. Once the reviewer returns APPROVE, follow Order of Operations step 5
>    above and set `Status: ✅ Complete` for real.
>
> Do NOT skip step 1. Leaving STATUS in the contradictory state ("Complete"
> + an open REVISE) is the failure mode this recipe exists to undo.

## C. Forbidden callout (insertion target: existing "WRONG sequence" callout block in `Review Protocol`, replacing or expanding it)

> ### ❌ FORBIDDEN sequences (these break the review contract)
>
> Workers MUST NOT do any of the following:
>
> 1. ~~Mark a step `Status: ✅ Complete` before its code review (Level ≥ 2)
>    has returned APPROVE.~~ This is the **death-spiral anti-pattern**: if
>    the reviewer subsequently returns REVISE, the worker enters a state
>    contradiction it cannot resolve and the lane is lost. If you did this
>    accidentally, follow the Recovery Recipe above.
> 2. ~~Hydrate, implement, check off, commit, THEN call plan review~~ —
>    this makes plan review pointless; the work is already written.
> 3. ~~Skip code review and proceed to the next step on a Review Level ≥ 2
>    task~~ — the merge agent will reject the lane.
>
> These rules sit alongside the existing "Workers MUST NOT add, remove, or
> renumber steps during execution" rule from STATUS.md Hydration → Rules.

## D. Option B engine-side guard

**Insertion target:** `extensions/taskplane/agent-bridge-extension.ts`,
inside the `review_step` tool's `execute` handler, **after** the
`taskFolder`/`statusPath` resolution and **before** the `reviewCounter`
read.

### Guard logic

1. **Only fires for `code` and `test` review types.** If `reviewType ===
   "plan"`, skip the guard entirely (plan reviews fire pre-implementation;
   STATUS being incomplete is correct at that point).
2. **Read STATUS.md** at `statusPath`. If the file doesn't exist or can't
   be read, skip the guard (best-effort; don't block reviews on file
   I/O hiccups).
3. **Locate the target step's section heading.** Scan for a heading like
   `### Step ${stepNum}:` (the same regex shape used elsewhere in the
   handler for step-name extraction).
4. **Within that step's section** (from its `### Step N:` heading to the
   next `### Step` heading or end-of-file), look for the step-level status
   line: `**Status:** ✅ Complete`. Match must be on a literal `**Status:**`
   line, not inside a code fence or table.
5. If found → return a refusal verdict:
   ```
   REFUSED: Step N is already marked `Status: ✅ Complete` in STATUS.md.
   Per the Order of Operations rule, code review must run BEFORE you
   mark a step Complete. Follow the Recovery Recipe in the worker prompt:
   1. Revert the step's Status to `🟨 In Progress` in STATUS.md
   2. Commit: chore(<TASK-ID>): revert premature step-N completion
   3. Re-call review_step(step=N, type="code", baseline=<sha>)
   ```
   The handler returns this as the tool result and does **not** spawn a
   reviewer (no review counter increment, no `.reviews/` file written).

### Why not also block on all-checkboxes-checked

The original PROMPT.md Step 3 mentions checking "all checkboxes within
that step's section show `[x]`". After analysis, that's a **false
positive trigger**: it's normal and expected for all checkboxes inside a
step to be `[x]` *before* the code review runs (Order of Operations
step 1 — implementation finishes, items are checked, code review fires).
Using all-checked as the trip wire would refuse the very review it's
supposed to enable.

The **only** signal that uniquely identifies the death-spiral state is
the step-level `Status: ✅ Complete` heading. That's what the guard
keys off.

### Refusal message wording

The refusal message above is the **canonical** wording. The Recovery
Recipe section in the worker prompt (Section B above) MUST use the same
three-step instruction sequence, in the same order, with matching commit
message text. Operators reading the prompt and the tool refusal back-to-
back will see consistent guidance.

### Test coverage for the guard

1. **Trip case:** STATUS shows `### Step 3:` with `**Status:** ✅ Complete` →
   `review_step(step=3, type="code")` returns refusal text containing the
   keyword "REFUSED" and the phrase "revert premature step-3 completion".
2. **Pass-through case:** STATUS shows `### Step 3:` with `**Status:** 🟨
   In Progress` and all individual checkboxes `[x]` → `review_step(step=3,
   type="code")` proceeds to the normal handler (we'll mock the spawn so
   the test doesn't actually run a reviewer).
3. **Plan-review bypass:** STATUS shows `### Step 3:` with `**Status:** ✅
   Complete` → `review_step(step=3, type="plan")` is **not** blocked by
   the guard (plan reviews are exempt by design).
4. **Missing STATUS.md:** Guard skips (does not refuse, does not crash).
5. **Step heading not found:** Guard skips (don't punish workers on
   unusual STATUS structures; the prompt fix is the primary defense).

---

## Insertion plan summary

| # | Section | File | Insertion point |
|---|---------|------|-----------------|
| A | Order of Operations | `templates/agents/task-worker.md` | Inside `## Review Protocol`, after the "Correct sequence" subsection and before "Example flow" |
| B | Recovery Recipe | `templates/agents/task-worker.md` | Immediately after section A |
| C | Forbidden callout | `templates/agents/task-worker.md` | Replaces the existing "WRONG sequence" callout block in `## Review Protocol` (the new C is a superset that preserves the old item as bullet 2) |
| D | Engine-side guard | `extensions/taskplane/agent-bridge-extension.ts` | Inside `review_step` `execute()`, after `taskFolder`/`statusPath` resolution, before `reviewCounter` read |
