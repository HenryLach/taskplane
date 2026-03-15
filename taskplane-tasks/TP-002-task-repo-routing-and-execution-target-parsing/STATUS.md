# TP-002: Task-to-Repo Routing and Execution Target Parsing — Status

**Current Step:** Step 0: Parse execution target metadata
​**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Parse execution target metadata
**Status:** ✅ Complete

**Parse grammar:**
- Section header: `## Execution Target` (with optional body containing `Repo: <id>`)
- Inline field in front-matter area: `**Repo:** <id>` (bold key, value is trimmed string)
- Precedence: section-based `## Execution Target` wins over inline `**Repo:**` if both present
- `<id>` is a lowercase alphanumeric-plus-hyphens string matching `/^[a-z0-9][a-z0-9-]*$/`
- Missing metadata = non-fatal (field defaults to `undefined`)

**Data contract:**
- `ParsedTask.promptRepoId?: string` — raw repo ID declared in the PROMPT, separate from resolved routing

**Backward compatibility:**
- Missing execution target metadata → no parse error, task remains valid
- No changes to existing ID/dependency/file-scope parsing behavior
- No new fatal discovery errors introduced in Step 0

- [x] Add `promptRepoId?: string` field to `ParsedTask` in `types.ts`
- [x] Implement section-based parser: `## Execution Target` with `Repo:` line
- [x] Implement inline parser: `**Repo:** <id>` in front-matter area
- [x] Apply precedence rule (section > inline) and repo ID validation
- [x] Preserve backward compat: missing metadata = `undefined`, no error
- [x] Add tests: prompt with no execution target
- [x] Add tests: section-based `## Execution Target` with `Repo: api`
- [x] Add tests: inline `**Repo:** frontend` declaration
- [x] Add tests: whitespace/case/markdown decoration variants
- [x] Add tests: both section + inline present (section wins)
- [x] Add tests: invalid repo ID format (non-matching = undefined)
- [x] Add tests: existing dependency/file-scope parsing unchanged

---

### Step 1: Implement routing precedence chain
**Status:** ⬜ Not Started

- [ ] Resolve repo using: prompt repo -> area map -> workspace default repo
- [ ] Emit explicit errors for unresolved or unknown repo IDs (TASK_REPO_UNRESOLVED, TASK_REPO_UNKNOWN)

---

### Step 2: Annotate discovery outputs
**Status:** ⬜ Not Started

- [ ] Attach resolved repoId to parsed tasks before planning
- [ ] Ensure routing errors fail planning with actionable messages

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit/regression tests passing
- [ ] Targeted tests for changed modules passing
- [ ] All failures fixed
- [ ] CLI smoke checks passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 06:28 | Task started | Extension-driven execution |
| 2026-03-15 06:28 | Step 0 started | Parse execution target metadata |
| 2026-03-15 06:31 | Review R001 | plan Step 0: changes requested |
| 2026-03-15 | Step 0 plan hydrated | Addressed R001 findings, concrete checklist |
| 2026-03-15 06:31 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 | Step 0 impl | types.ts: promptRepoId field already added by prior iter |
| 2026-03-15 | Step 0 impl | discovery.ts: section+inline parser already added by prior iter |
| 2026-03-15 | Step 0 tests | Created discovery-prompt-parser.test.ts — 28/28 pass |
| 2026-03-15 | Step 0 complete | All checklist items verified and checked off |

## Blockers

*None*

## Notes

*Reserved for execution notes*
