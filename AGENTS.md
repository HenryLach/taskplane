# AGENTS.md

## Purpose

This is the **north star** for AI coding agents working on Taskplane.

Taskplane is an experimental but production-minded pi package for:
- single-task autonomous execution (`/task`)
- dependency-aware parallel orchestration (`/orch*`)
- file-backed state, resumability, and observability

When in doubt, optimize for: **determinism, recoverability, and clear operator visibility**.

---

## Project map (what to read first)

### 1) Global orientation
1. `README.md` (user-facing behavior)
2. `docs/README.md` (full docs map)
3. `docs/explanation/architecture.md`

### 2) If your change is about `/orch*`
- `extensions/taskplane/extension.ts` (command surface)
- `extensions/taskplane/discovery.ts` (task discovery + deps)
- `extensions/taskplane/waves.ts` (DAG/waves/assignment)
- `extensions/taskplane/execution.ts` (lane execution)
- `extensions/taskplane/merge.ts` (merge flow)
- `extensions/taskplane/persistence.ts` + `resume.ts` (resume/state)
- `extensions/taskplane/types.ts` (defaults + contracts)
- `docs/reference/commands.md`
- `docs/reference/configuration/task-orchestrator.yaml.md`

### 3) If your change is about CLI/dashboard/scaffolding
- CLI: `bin/taskplane.mjs`
- Dashboard: `dashboard/server.cjs`, `dashboard/public/*`
- Templates: `templates/**`
- Packaging: `package.json`, `docs/maintainers/package-layout.md`

### 4) Tests
- `extensions/tests/*`
- `docs/maintainers/testing.md`

---

## Core architecture invariants (do not break casually)

1. **File-backed execution memory is fundamental**
   - `STATUS.md` is persistent task memory.
   - `.DONE` is authoritative completion marker.

2. **Orchestrator state must be resumable**
   - Persisted state in `.pi/batch-state.json` is part of runtime contract.
   - Resume/abort flows depend on consistent state semantics.

3. **Task execution and orchestration are separate concerns**
   - `/orch*` behavior coordinates discovery/waves/lanes/worktrees/merge.

4. **Templates are public scaffolding, not project-specific policy**
   - Keep template examples generic and safe for open-source distribution.

5. **Published package boundaries matter**
   - Only files in `package.json#files` ship.
   - Changes to package layout or manifest impact install/runtime behavior.

6. **Configuration lives in `taskplane-config.json`, not YAML**
   - The canonical project config file is `.pi/taskplane-config.json` (JSON, camelCase keys).
   - Legacy `.pi/task-runner.yaml` and `.pi/task-orchestrator.yaml` files may still exist but are **fallback only** — the JSON config takes precedence when present.
   - When reading or modifying configuration, always check for `taskplane-config.json` first.
   - When documenting config changes, reference the JSON format and keys (e.g., `taskRunner.reviewer.thinking`, not `reviewer:\n  thinking:`).
   - User preferences live in `~/.pi/agent/taskplane/preferences.json` and override project config.
   - See `extensions/taskplane/config-loader.ts` and `extensions/taskplane/config-schema.ts` for the loading chain and defaults.

---

## Always do

1. **Read before editing**
   - Inspect relevant code paths + reference docs before making changes.

2. **Keep behavior and docs aligned**
   - If command/config/format behavior changes, update docs in the same change.

3. **Add or update tests for behavior changes**
   - Especially for discovery, waves, persistence/resume, and command parsing.

4. **Run validations locally (minimum)**
   - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
   - If CLI changed: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`

5. **Preserve compatibility intentionally**
   - If changing external contracts (commands, config keys, state schema), do it explicitly and document it.

6. **Keep commits scoped and reviewable**
   - Separate docs, templates, and runtime logic where possible.

7. **Prefer small, deterministic changes**
   - Avoid broad refactors unless required by the task.

---

## Never do

1. **Never `git reset --hard` when you have uncommitted or staged changes.** Use `git stash` first, or commit to a branch. Hard reset silently destroys work that must then be re-applied from scratch.
2. **Never hardcode machine/user-specific paths or private environment assumptions.**
2. **Never leak internal/planning artifacts into public docs/templates.**
3. **Never make template content project- or language-specific.**
4. **Never silently change command names/flags or config schema fields.**
5. **Never break persistence/resume semantics without schema + docs + tests updates.**
6. **Never bypass `.DONE` / `STATUS.md` conventions in task execution flow.**
7. **Never introduce unnecessary build/runtime complexity for dashboard or extensions.**
8. **Never publish/release as part of routine code edits unless explicitly requested.**

---

## Change checklists by area

### Command behavior changes (`/task`, `/orch*`, CLI)
- Update implementation
- Update `docs/reference/commands.md`
- Update README command tables if needed
- Add/adjust tests

### Config changes (`task-runner.yaml` / `task-orchestrator.yaml`)
- Update defaults/types/loaders in code
- Update templates in `templates/config/`
- Update config reference docs
- Add/adjust tests for parsing/defaulting

### Task format / status semantics changes
- Update parser logic carefully
- Keep backward compatibility where possible
- Update `docs/reference/task-format.md` and `docs/reference/status-format.md`
- Add fixtures/tests for edge cases

### Persistence/resume changes
- Update `types.ts` schema/constants as needed
- Update `persistence.ts` + `resume.ts` together
- Add regression tests for recovery paths
- Update explanation/how-to docs

### Template changes
- Validate with `taskplane init --dry-run` (or real init in scratch repo)
- Ensure generated files are generic and coherent

---

## Git/GitHub workflow policy (for agents)

### Branching strategy

- `main` is protected and should remain releasable.
- Default to short-lived topic branches from latest `main`:
  - `feat/<topic>`
  - `fix/<topic>`
  - `docs/<topic>`
  - `chore/<topic>`
  - `refactor/<topic>`
  - `test/<topic>`
- Keep one logical change per PR.

### Default command recipe (unless user asks otherwise)

1. Sync and branch:
   - `git switch main`
   - `git pull --ff-only`
   - `git switch -c <type/topic>`
2. Implement changes + run relevant validation.
3. Commit with conventional format:
   - `type(scope): short description`
4. Push and open PR:
   - `git push -u origin <branch>`
   - `gh pr create --fill`
5. Ensure required checks pass (`ci`) and conversations are resolved.
6. Merge and delete branch:
   - `gh pr merge --merge --delete-branch`
7. Sync local after merge:
   - `git switch main && git pull --ff-only`

### Protection/bypass rule

- Do **not** bypass branch protection or push directly to `main` unless explicitly instructed by the user for an urgent exception.
- If merge is blocked unexpectedly, inspect:
  - `gh pr view <n> --json mergeStateStatus,statusCheckRollup`
  - `gh pr checks <n>`
  - `gh api repos/HenryLach/taskplane/branches/main/protection`

---

## Release strategy (for agents)

- GitHub release and npm publish are related but distinct:
  - `npm publish` ships installable package bits.
  - GitHub release publishes human-facing release metadata for a tag.
- Keep them aligned: **one version → one tag → one npm publish → one GitHub release**.
- **Both are now automated** via `.github/workflows/release.yml` (npm Trusted
  Publishing). Pushing a `v*` tag triggers the workflow, which:
  1. Checks out the tagged commit
  2. Validates the tag name matches `package.json#version` (no drift allowed)
  3. Re-runs tests as belt-and-suspenders
  4. Publishes to npm with `--provenance` attestation (OIDC, no `NPM_TOKEN` secret)
  5. Creates the GitHub release with notes extracted from `CHANGELOG.md`
- Authentication is via [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers).
  Do NOT add `NPM_TOKEN` to repository secrets; the workflow uses OIDC. The
  trusted publisher is configured at <https://www.npmjs.com/package/taskplane/access>.

### Default release sequence (only when explicitly requested)

This is the actual flow used for v0.28.5 → v0.29.0 (verified across 5
consecutive releases).

1. **Ensure `main` is clean and synced; all content PRs already merged.**
   - `git switch main && git pull --ff-only`
   - All bug-fix / feature PRs that should ship in this release must already
     be in `main`. The release PR is a thin wrapper around the version bump,
     not a content PR.

2. **Validate package contents and run pre-release checks.**
   - `npm pack --dry-run` (confirm only intended files ship)
   - `cd extensions && npm run test:fast` (full fast suite passes; record count for CHANGELOG)
   - `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor` (CLI smoke)

3. **Create the release branch and update `CHANGELOG.md` (MANDATORY).**
   - `git switch -c release/v<version>`
   - Rename the existing `## [Unreleased]` section to `## [<version>] - <YYYY-MM-DD>`
   - Insert a fresh empty `## [Unreleased]` placeholder above it
   - Add any `Fixed` entries for hotfixes that landed on `main` after the
     last `[Unreleased]` write but before the version bump (these are easy
     to miss if you only look at `[Unreleased]`)
   - Group by: Breaking, New, Enhanced, Fixed, Docs, Internal
   - This is the permanent record of what shipped. The release workflow
     extracts release notes from this section verbatim.

4. **Bump version and create the local tag.**
   - `npm version patch` (or `minor` / `major`)
   - This updates `package.json`, `package-lock.json`, creates a git commit
     (`<version>`), AND creates a local tag (`v<version>`). Don't push the
     tag yet — it goes after the PR merges.

5. **Push the release branch and open the release PR.**
   - `git push -u origin release/v<version>`
   - `gh pr create --base main --head release/v<version> --title "release: v<version> — <summary>" --body-file <body>`
   - PR body should: explain why the version bump (patch/minor/major
     justification per semver), list issues closed, summarize highlights,
     note validation results.

6. **Wait for CI green, then merge the release PR.**
   - `gh pr merge <num> --merge --delete-branch` (preserves the version-bump
     commit in main's history under a merge commit)
   - DO NOT use `--squash` or `--rebase` — the version-bump commit needs to
     stay intact so the tag points at it.

7. **Sync local main, then push the tag to trigger the release workflow.**
   - `git switch main && git pull --ff-only`
   - `git push origin v<version>` — this is what triggers the publish workflow
   - The workflow runs in ~30-60 seconds. Monitor with:
     `gh run list --workflow=release.yml --limit 1`

8. **Verify everything published correctly.**
   - `npm view taskplane version` — should show the new version (allow ~10-15s
     for npm registry propagation)
   - `gh release view v<version>` — should show the GitHub release with notes
   - Optional: `npm view taskplane versions --json | tail` to confirm the
     version is in the published list

**Pre-release checklist (verify before step 3):**
- [ ] `main` is clean and synced (`git status -sb` shows no diverging commits)
- [ ] All content PRs that should ship are already merged
- [ ] Tests pass: `cd extensions && npm run test:fast`
- [ ] CLI smoke: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`
- [ ] No uncommitted changes
- [ ] Hotfix scan: any commits on `main` after the last `[Unreleased]` write
      that need a CHANGELOG entry?

**What NOT to do:**
- Do **not** run `npm publish` locally. The workflow does it. Local publish
  bypasses the tag’version validation, the test re-run, and the provenance
  attestation — and it can’t use OIDC, so it would either fail (no
  `NPM_TOKEN` configured) or use a less-trusted credential.
- Do **not** create the GitHub release manually with `gh release create`.
  The workflow does it with notes extracted from `CHANGELOG.md`. A manual
  release would either conflict with the workflow's release or duplicate
  it on the same tag.
- Do **not** push the tag before the release PR is merged. The tag must
  point at a commit that’s already in `main` (otherwise the release
  references an orphan commit not reachable from any branch).
- Do **not** use `--squash` or `--rebase` to merge the release PR. Both
  rewrite the version-bump commit's SHA, which would orphan the local tag
  you created in step 4. Use `--merge`.
- Never perform publish/release actions unless the user explicitly asks.

**If the workflow fails:**
- Inspect with `gh run view <run-id> --log-failed`
- Common causes: tag/version mismatch (workflow validates this), test
  failure on the re-run (unlikely if PR CI was green), npm registry
  hiccup (rare; re-trigger via Actions UI workflow_dispatch with the same
  tag input)
- The workflow is idempotent on a re-run for the same tag — npm rejects
  republish of an existing version, but the GitHub release step uses
  `gh release create --notes-file ...` which replaces existing notes.

---

## Supervisor tools reference

When operating as the supervisor (during `/orch` execution), these tools are available:

| Tool | Usage | Description |
|------|-------|-------------|
| `orch_start(target)` | `target="all"`, area name, directory, or PROMPT.md path(s) | Start a batch. Multiple PROMPT.md paths can be space-separated. |
| `orch_status()` | No params | Check batch phase, wave progress, task counts |
| `orch_pause()` | No params | Pause after current tasks finish |
| `orch_resume(force?)` | `force=true` for stopped/failed state | Resume a paused batch |
| `orch_abort(hard?)` | `hard=true` for immediate kill | Abort the running batch |
| `orch_retry_task(taskId)` | Task ID (e.g., `"TP-003"`) | Reset a failed task for re-execution |
| `orch_skip_task(taskId)` | Task ID | Skip a task and unblock dependents |
| `orch_force_merge(waveIndex?, skipFailed?)` | 0-based wave index | Force merge a wave with mixed results |
| `orch_integrate(mode?, force?, branch?)` | `mode="fast-forward"\|"merge"\|"pr"` | Integrate completed batch into working branch |
| `send_agent_message(to, content, type?)` | Agent session name | Steer a running agent |
| `read_agent_replies(from?)` | Agent ID or omit for all | Read replies/escalations (non-consuming) |
| `broadcast_message(content, type?)` | Content string | Send to all agents (all-or-none rate limit) |
| `read_agent_status(lane?)` | Lane number or omit for all | Read STATUS.md + telemetry for a lane |
| `list_active_agents()` | No params | Show all running agent sessions |
| `trigger_wrap_up(lane)` | Lane number | Signal a worker to finish and exit |
| `read_lane_logs(lane)` | Lane number | Read stderr/crash logs for a lane |

---

## Practical dev commands

- Run extensions locally:
  - `pi -e extensions/task-orchestrator.ts`

- Run tests:
  - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`

> Note: Historical task artifacts/spec snapshots may still mention Vitest commands.
> Those references are archival only — the active test runner is Node's native `node:test`.

---

## Decision rule when uncertain

Prefer the option that best preserves:
1. **correctness** (tests/contracts)
2. **recoverability** (state + resume)
3. **operator clarity** (status, logs, dashboard)
4. **minimal surprise** (stable commands/config/docs)

If code and docs disagree, treat code as current behavior and update docs accordingly.

---

## Notation

- `/orch*` in this document is shorthand for the orchestrator command family (`/orch`, `/orch-plan`, `/orch-status`, `/orch-pause`, `/orch-resume`, `/orch-abort`, `/orch-deps`, `/orch-sessions`).
- It is **not** a literal command to run.
