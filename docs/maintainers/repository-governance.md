# Repository Governance (GitHub Setup)

This guide defines Taskplane's recommended GitHub governance model for open-source collaboration.

## Goals

- Keep `main` stable and releasable
- Make contribution flow clear for new contributors
- Catch regressions before merge
- Keep issue triage consistent and transparent

---

## Branch Strategy

### Default branch

- `main` is the only long-lived branch.
- Release from `main`.

### Working branches

Use short-lived topic branches:

- `feat/<short-topic>`
- `fix/<short-topic>`
- `docs/<short-topic>`
- `chore/<short-topic>`
- `refactor/<short-topic>`
- `test/<short-topic>`

Examples:

- `feat/orch-single-task-isolation-docs`
- `fix/uninstall-dry-run-prompt`
- `docs/repository-governance`

### Merge strategy

- Use **Squash merge** into `main` (default)
- Delete branch after merge
- Keep one logical change per PR

---

## Pull Request Strategy

### Expectations

Each PR should:

1. Link to an issue (or explain why issue is unnecessary)
2. Be focused and reviewable
3. Pass CI checks
4. Include docs updates for user-visible changes
5. Include tests for behavior changes where feasible

### Review policy (current)

- PR required before merge to `main`
- CI checks required
- Conversation resolution required
- Required approving reviews: `0` (solo-maintainer friendly baseline)

> When maintainership expands, increase required approvals to `1+`.

---

## Branch Protection (main)

Recommended protections for `main`:

- Require pull request before merging
- Require status checks to pass (`CI / ci`)
- Require branches to be up to date before merge
- Require conversation resolution before merge
- Dismiss stale reviews on new commits
- Block force pushes
- Block branch deletion

---

## Issue Tracking Strategy

Use GitHub Issues as the canonical backlog.

### Intake

- Bug reports: use bug issue form
- Feature requests: use feature issue form
- Docs gaps: use docs improvement issue form
- Questions: route to Discussions (not Issues)

### Triage labels

Suggested taxonomy:

- Type: `type:bug`, `type:feature`, `type:docs`, `type:chore`
- Area: `area:runner`, `area:orchestrator`, `area:cli`, `area:dashboard`, `area:docs`
- Priority: `priority:P0` … `priority:P3`
- Status: `status:needs-triage`, `status:blocked`, `status:ready`
- Onboarding: `good first issue`, `help wanted`

### Triage SLA (suggested)

- New issue acknowledged: within 3 business days
- Initial triage label assignment: within 7 business days

---

## Automation Baseline

- CI workflow on `push`/`pull_request` to `main`
- Dependabot for GitHub Actions + `extensions/` npm dependencies
- CODEOWNERS for reviewer routing
- Issue forms + PR template for structured intake

---

## One-time GitHub CLI Setup Commands

Run from any shell with `gh` authenticated.

### 1) Repository settings

```bash
gh api --method PATCH repos/HenryLach/taskplane \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true \
  -f allow_auto_merge=true \
  -f has_issues=true \
  -f has_discussions=true
```

### 2) Branch protection for `main`

```bash
gh api --method PUT repos/HenryLach/taskplane/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -F required_status_checks[strict]=true \
  -f required_status_checks[contexts][]=CI\ /\ ci \
  -F enforce_admins=false \
  -F required_pull_request_reviews[dismiss_stale_reviews]=true \
  -F required_pull_request_reviews[require_code_owner_reviews]=false \
  -F required_pull_request_reviews[required_approving_review_count]=0 \
  -F required_conversation_resolution=true \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  -F block_creations=false
```

### 3) Add triage labels

```bash
gh label create "type:bug" --color "D73A4A" --description "Confirmed bug" || true
gh label create "type:feature" --color "A2EEEF" --description "Feature request" || true
gh label create "type:docs" --color "0075CA" --description "Documentation work" || true
gh label create "type:chore" --color "C5DEF5" --description "Maintenance work" || true

gh label create "area:runner" --color "5319E7" --description "Task runner" || true
gh label create "area:orchestrator" --color "1D76DB" --description "Parallel orchestrator" || true
gh label create "area:cli" --color "0E8A16" --description "CLI and scaffolding" || true
gh label create "area:dashboard" --color "FBCA04" --description "Dashboard UI/server" || true
gh label create "area:docs" --color "006B75" --description "Documentation" || true

gh label create "priority:P0" --color "B60205" --description "Critical" || true
gh label create "priority:P1" --color "D93F0B" --description "High" || true
gh label create "priority:P2" --color "FBCA04" --description "Medium" || true
gh label create "priority:P3" --color "0E8A16" --description "Low" || true

gh label create "status:needs-triage" --color "EDEDED" --description "Awaiting triage" || true
gh label create "status:blocked" --color "000000" --description "Blocked by external dependency" || true
gh label create "status:ready" --color "0E8A16" --description "Ready for implementation" || true
```

---

## Ongoing Maintainer Cadence (suggested)

Weekly:

1. Triage new issues and apply labels
2. Re-scope stale PRs/issues or close when out-of-scope
3. Curate 1–3 `good first issue` items
4. Review Dependabot updates
