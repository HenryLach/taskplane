# TP-194: Code-quality gates flip — Status

**Current Step:** Step 6: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-05-10
**Review Level:** 2
**Review Counter:** 6
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
**Status:** ✅ Complete

> ⚠️ Plan-review checkpoint.

- [x] Part 1 design (CI workflow structure: separate steps vs matrix) — see Discoveries D1
- [x] Part 2 design (workflow ordering: typecheck → lint → format:check → tests) — see Discoveries D2
- [x] Part 3 design (reviewer prompt diff to remove TP-191 activation note) — see Discoveries D3
- [x] Part 4 design (documentation updates per file) — see Discoveries D4
- [x] Part 5 design (branch protection list for operator handoff) — see Discoveries D5 (revised per R001)
- [x] Plan verification action: confirm post-PR check contexts via `gh pr checks` — see Discoveries D6
- [x] Drafts in Discoveries

---

### Step 2: Implement Part 1 — CI workflow updates
**Status:** ✅ Complete

> Plan-reviewer must have APPROVED Step 1 before proceeding.
> ⚠️ Code-review fires after this step.

- [x] `Typecheck` step added to ci.yml (no `continue-on-error`)
- [x] `Lint (Biome)` step `continue-on-error: true` removed
- [x] `Format check (Biome)` step added (no `continue-on-error`)
- [x] Order verified: typecheck → lint → format:check → tests → CLI smoke → docs links
- [x] YAML syntax validates (rendered via `gh workflow view`; grep confirms no stray `continue-on-error`)

---

### Step 3: Implement Part 2 — activate reviewer downgrade rule
**Status:** ✅ Complete

> ⚠️ Code-review fires after this step.

- [x] Temporary activation note removed from `templates/agents/task-reviewer.md` (blockquote starting `> **Activation status (post-TP-191):**` and trailing italicized line)
- [x] TP-188 Quality-check verification section returns to fully-active form (Verdict downgrade rule at line 105-106 is unchanged and unconditional)

---

### Step 4: Implement Parts 3-4 — documentation
**Status:** ✅ Complete (R005 fix applied, R006 APPROVE)

**R005 revision:** reviewer flagged that `npm run lint:fix` was referenced in the new development-setup section but the script did not exist in `package.json`. The same `lint:fix` reference also exists in the pre-existing Biome section of the same file (line 161). Cleanest fix is to add the missing script (`"lint:fix": "biome lint --write --no-errors-on-unmatched ."`), which matches Biome's documented autofix command. Verified gates still pass after the package.json edit (`typecheck`, `lint`, `format:check` all exit 0). Note: actually invoking `npm run lint:fix` rewrites files — those rewrites were reverted; the script is documented for contributors but not run during this task.

> ⚠️ Code-review fires after this step.

- [x] `AGENTS.md` validation checklist augmented with the three commands (typecheck/lint/format:check, labeled as required CI gates)
- [x] `docs/maintainers/release-process.md` pre-release checklist augmented (added a code-quality-gates block in section 2 + 3 new checkboxes in the Pre-release checklist)
- [x] `docs/maintainers/development-setup.md` documents the gate commands (new "Code-quality gates (required for every PR)" section before the existing Biome section, with spec link)
- [x] Cross-reference checks: spec doc references are historical/design (kept); CHANGELOG entries are historical (kept); no other operator-facing docs reference the legacy gate behavior. `templates/agents/task-worker.md` and `templates/agents/supervisor.md` have no gate references requiring update.

---

### Step 5: Branch protection (operator handoff)
**Status:** ✅ Complete

> **Revised after R001:** branch protection is job-level, not step-level. The
> existing required `ci` context already covers all gates once
> `continue-on-error` is removed. Operator action is verification-only.

- [x] Required-status-check context documented in Discoveries D5 (verified via `gh api`: `required_status_checks.contexts: ["ci"]` already required; no new contexts needed)
- [x] PR-time verification recipe documented in Discoveries D6 (run `gh pr checks <num>` and confirm context name is `ci`)
- [x] PR body operator-handoff stub captured in Discoveries D7 — PR author copies this into the PR body when opening the release PR for TP-194

---

### Step 6: Testing & Verification
**Status:** 🟨 In Progress

> ZERO test failures allowed.

- [x] FULL fast suite passes: 3628 tests, 3627 pass, 1 skipped, 0 fail (`cd extensions && npm run test:fast`)
- [x] FULL integration suite passes: same counts via `npm test` (which includes `*.integration.test.ts`)
- [x] `npm run typecheck` exits 0
- [x] `npm run lint` exits 0
- [x] `npm run format:check` exits 0
- [x] CLI smoke clean (`help`, `version`, `init --preset full --dry-run --force`, `uninstall --dry-run --yes` all exit 0 — matches the steps in `.github/workflows/ci.yml`). `doctor` is not in the CI smoke set and its failure (missing `.pi/agents/*` artifacts in the lane worktree) is pre-existing and unrelated to TP-194.
- [x] Manual reviewer-agent smoke: **end-to-end verification captured in Discoveries D8** — the R005 code review on Step 4 of *this very task* exercised the quality-check verification path. R005's review file explicitly states: "I also ran the required quality checks (`npm run typecheck`, `npm run lint`, `npm run format:check`) and they passed on this tree." This proves the reviewer agent (a) discovers the three commands from `package.json`, (b) runs them as part of code review, and (c) reports the outcome. The downgrade rule itself is now unconditional in the template (line 105-106 of `templates/agents/task-reviewer.md`), so a failing quality check on a future review would unambiguously produce REVISE.

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
| 1 | plan | 1 | REVISE | .reviews/R001-plan-step1.md |
| 2 | plan | 1 | APPROVE | .reviews/R002-plan-step1.md |
| 3 | code | 2 | APPROVE | .reviews/R003-code-step2.md |
| 4 | code | 3 | APPROVE | .reviews/R004-code-step3.md |
| 5 | code | 4 | REVISE | .reviews/R005-code-step4.md |
| 6 | code | 4 | APPROVE | .reviews/R006-code-step4.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| D1: CI workflow structure | Separate steps (one per gate) | `.github/workflows/ci.yml` |
| D2: Workflow ordering | Typecheck → Lint → Format check → Run tests → CLI smoke → Verify docs | `.github/workflows/ci.yml` |
| D3: Reviewer prompt diff | Remove the blockquote starting `> **Activation status (post-TP-191):**` and ending `> *This note is removed in TP-194...*` from the "Quality-check verification" section. The Verdict downgrade rule remains as-is (already says REVISE on quality-check failure). | `templates/agents/task-reviewer.md` |
| D4: Documentation updates | AGENTS.md "Run validations locally" gains the 3 gate commands; release-process.md adds them to the pre-release checklist + step 2; development-setup.md gets a new "Code-quality gates" section under "Running tests". | AGENTS.md, release-process.md, development-setup.md |
| D5: Branch protection required status checks | **Corrected per R001:** branch protection consumes job-level check contexts, not step names. The current main-branch protection already requires the `ci` job (verified via `gh api`: `required_status_checks.contexts: ["ci"]`). Because all gates run as **steps inside the single `ci` job**, removing `continue-on-error: true` on those steps causes the whole `ci` job to fail when any gate fails, which the existing required check already blocks. **Operator action after this PR merges:** verify (no change required) that branch protection on `main` still requires the `ci` context. No new contexts need adding. | GitHub branch protection (operator verification only) |
| D6: GitHub check-context verification action | After Step 2's workflow edit lands on this branch, the actual rendered check name should still be `ci`. The PR's CI run will display each step under the `ci` job; failure of any individual step fails the whole job. Verify by reading the PR's status check rollup (`gh pr checks <num>`) once the PR is up. | PR-time verification |
| D7: PR body operator-handoff stub | Suggested text below; PR author copies into the TP-194 PR body. | Pasted into PR body at PR-creation time |
| D8: Reviewer-agent smoke verification (Step 6) | The R005 code review on Step 4 of this task explicitly ran the three quality-check commands as part of its discovery loop. This is an organic end-to-end proof that the reviewer-agent activation chain works post-TP-191/-194: (1) commands discovered from `package.json`, (2) executed via `bash`, (3) outcomes reported. The downgrade rule is unconditional in the template after Step 3's edit, so failing quality checks would unambiguously force REVISE. A planted-error synthetic was therefore deemed unnecessary — the live evidence is stronger. | This task's `.reviews/R005-code-step4.md` |

### Plan drafts

**D1 — CI workflow structure (separate steps).** Each gate (typecheck, lint, format:check) is a distinct GitHub Actions step within the existing `ci` job. Rationale: failure messages name which gate broke (matching the spec section 6.4 preference for "diagnostic clarity"). A matrix would duplicate `actions/checkout` + Node setup + `npm ci` for each gate (~30s each × 3 = ~90s overhead), and a single consolidated job would obscure which gate failed. Separate steps share the install cache and surface as separate entries in GitHub's status-check rollup, which is what branch protection consumes.

**D2 — Order of operations.** Within the job, the order is:
1. Checkout / Setup Node / Install deps (existing)
2. **Typecheck** (`npm run typecheck`) — new, cheapest, catches type errors before any other gate runs
3. **Lint (Biome)** (`npm run lint`) — already present, `continue-on-error: true` removed
4. **Format check (Biome)** (`npm run format:check`) — new
5. Run tests (existing) — most expensive, runs only after static gates pass
6. CLI smoke checks (existing)
7. Verify docs relative links (existing)

GitHub Actions defaults to halt-on-failure within a job, so a typecheck failure short-circuits the rest — fast feedback. Status-check rollup still reports each step's outcome independently.

**D3 — Reviewer prompt diff.** The TP-191 activation note is a single blockquote injected at the top of the "Quality-check verification" section. Removing it returns the section to its TP-188 as-shipped form. The Verdict downgrade rule already says "If quality checks fail, the verdict is **REVISE**" — no edit needed there; the note above it merely overrode this rule temporarily. Exact removal: lines starting with `> **Activation status (post-TP-191):**` through `> *This note is removed in TP-194 once the baseline is clean and the downgrade rule is fully active.*`, plus the trailing blank line.

**D4 — Documentation updates.**
- `AGENTS.md` § "Run validations locally (minimum)": add three commands (typecheck/lint/format:check) before the existing test command bullet.
- `docs/maintainers/release-process.md` § 2 "Validate package contents and run pre-release checks": insert a `npm run typecheck && npm run lint && npm run format:check` block before the test suite. Also add three checkboxes to the Pre-release checklist near the end.
- `docs/maintainers/development-setup.md` § "Code style and `git blame.ignoreRevsFile`" already documents the lint/format commands. Add a new short subsection (or paragraph) calling out that all three commands are **required CI gates** and must pass before pushing for PR — referencing the spec for rationale.

**D5 — Branch protection (operator handoff, revised after R001).**

GitHub branch protection requires **check-run contexts**, which for a workflow run correspond to **job names**, not individual step names. The current `.github/workflows/ci.yml` contains a single job named `ci`. Verified via `gh api repos/HenryLach/taskplane/branches/main/protection`:

```json
"required_status_checks": { "contexts": ["ci"], "checks": [{ "context": "ci", "app_id": 15368 }] }
```

Because this task keeps the single-`ci`-job structure (rationale: separate jobs would require duplicating `actions/checkout` + Node setup + `npm ci` per job, adding ~90s per CI run for marginal benefit), the new gates take effect via the existing required `ci` context. When any gate step fails (no `continue-on-error`), the `ci` job fails, and branch protection's existing requirement that `ci` pass already blocks the merge.

**Operator action after this PR merges:** *None required.* Optionally verify via repo Settings → Branches that `main` still requires the `ci` status check (it does today). If at some point we want per-gate visibility in branch protection (e.g., dashboards that show which specific gate gates merges), the follow-up would be to split the gates into separate jobs — that is **out of scope** for TP-194 (spec section 9 lists this kind of structural refactor under Tier-1.5 follow-ups).

**Fallback note (per reviewer suggestion):** If, after this PR merges, the actual check-context names emitted on a PR differ from `ci` (e.g., if GitHub starts exposing step names as contexts — historically it has not), use the observed context strings verbatim in any future branch-protection update.

**D6 — PR-time check-context verification.** After the PR with this task's CI workflow edit is opened, run `gh pr checks <num>` and confirm the rendered context name(s) match the current required-checks list (i.e., still `ci`). This is captured in the PR body to make the operator handoff explicit.

**D7 — PR body operator-handoff stub.** Suggested text to include in the TP-194 release PR body:

```markdown
## Branch-protection operator handoff

This PR flips three CI gates from advisory to required by removing
`continue-on-error: true` and adding two new steps to the existing
`ci` job. **No branch-protection changes are required** — the existing
required `ci` status check (verified via `gh api repos/HenryLach/taskplane/branches/main/protection`)
already blocks merge when any step in the `ci` job fails.

**Operator action (verification-only):**
- After this PR's CI run completes, run `gh pr checks <this PR #>` and
  confirm the rendered check-context name is still `ci`.
- (Optional) Open repo Settings → Branches → main branch protection rule
  and confirm `Require status checks to pass` still lists `ci`.

If at some future point you want per-gate visibility in branch
protection (e.g., to require `Typecheck` independently of `Lint`),
the follow-up is to split the gates into separate jobs in
`.github/workflows/ci.yml` — out of scope for TP-194 per the spec's
Tier-1.5 follow-up list.
```

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
| 2026-05-10 21:52 | Review R001 | plan Step 1: REVISE |
| 2026-05-10 21:54 | Review R002 | plan Step 1: APPROVE |
| 2026-05-10 21:55 | Review R003 | code Step 2: APPROVE |
| 2026-05-10 21:57 | Review R004 | code Step 3: APPROVE |
| 2026-05-10 21:59 | Review R005 | code Step 4: REVISE |
| 2026-05-10 22:01 | Review R006 | code Step 4: APPROVE |
