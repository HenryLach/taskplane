# Task: TP-063 - Add Additive Upgrade Migrations on /orch

**Created:** 2026-03-25
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Introduces upgrade/migration behavior in extension startup and /orch preflight. Medium blast radius because it mutates project files automatically (additive-only) and needs strong safety/idempotency guarantees.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-063-upgrade-migrations-on-orch/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Existing users who run `pi update` then immediately run `pi`/`/orch` may miss newly introduced scaffold files (e.g. `.pi/agents/supervisor.md` from TP-058). They typically do **not** run `taskplane doctor` + `taskplane init` after every update.

Implement an additive migration mechanism that runs automatically when extensions are used, with `/orch` preflight as the primary trigger and extension load as a safety net.

### Scope for this task

1. Add a lightweight migration runner for **additive-safe** migrations only
2. Trigger it on `/orch` preflight (primary) and extension load (safety net)
3. Implement first migration: create missing `.pi/agents/supervisor.md` from template if absent
4. Track migration completion in `.pi/taskplane.json` so migrations run once per repo

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/extension.ts` (orch preflight/start paths)
- `bin/taskplane.mjs` (init behavior; context only)
- `templates/agents/local/supervisor.md`
- Issue context: #211

## Environment

- **Workspace:** `extensions/taskplane/`, `templates/agents/local/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/migrations.ts` (new)
- `extensions/tests/*` (add/extend migration tests)
- `bin/taskplane.mjs` (only if needed for compatibility messaging)

## Steps

### Step 0: Preflight

- [ ] Read `/orch` command flow and preflight path in `extension.ts`
- [ ] Read where `.pi/taskplane.json` is read/written today
- [ ] Confirm template source path for `templates/agents/local/supervisor.md`

### Step 1: Add Migration Runner

- [ ] Create `migrations.ts` with a small registry of additive migrations
- [ ] Define migration metadata: `id`, `description`, `run()`
- [ ] Add idempotent runner that:
  - loads migration state from `.pi/taskplane.json`
  - runs only unapplied additive migrations
  - records applied migration IDs + timestamp
  - never overwrites existing files

### Step 2: Wire Trigger Points

- [ ] Trigger migration runner in `/orch` preflight (primary)
- [ ] Add extension-load safety trigger (single-run, cheap)
- [ ] Ensure failures are non-fatal for additive migration (warn + continue)

### Step 3: Implement First Migration (Supervisor Scaffold)

- [ ] Migration ID: `add-supervisor-local-template-v1`
- [ ] If `.pi/agents/supervisor.md` missing, copy from `templates/agents/local/supervisor.md`
- [ ] If file exists, skip without mutation
- [ ] Log concise operator message when migration creates files

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Add tests for:
  - migration runs once and writes state
  - existing file is not overwritten
  - `/orch` preflight triggers migration
  - extension-load safety trigger is idempotent
- [ ] Run full tests: `cd extensions && npx vitest run`
- [ ] CLI smoke: `node bin/taskplane.mjs help`

### Step 5: Documentation & Delivery

- [ ] Update docs where appropriate (upgrade behavior note)
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Completion Criteria

- [ ] Existing initialized repo with missing supervisor scaffold gets `.pi/agents/supervisor.md` automatically on `/orch`
- [ ] Migration state persisted so it does not rerun unnecessarily
- [ ] No overwrites of existing files
- [ ] Tests pass

## Do NOT

- Add destructive migrations in this task
- Overwrite any user-edited `.pi/agents/*` files
- Block `/orch` execution if migration fails

---

## Amendments
