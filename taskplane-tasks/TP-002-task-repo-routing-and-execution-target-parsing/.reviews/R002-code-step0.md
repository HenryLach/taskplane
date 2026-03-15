# R002 — Code Review (Step 0: Parse execution target metadata)

## Verdict
**Changes requested** — parser behavior currently violates Step 0 grammar/precedence in edge cases that can mis-route tasks.

## Reviewed scope
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/discovery-routing.test.ts`
- Neighboring parser/test patterns in `extensions/taskplane/*` and `extensions/tests/*`

## What I validated
- `git diff 79c7bd3..HEAD --name-only`
- `git diff 79c7bd3..HEAD`
- Ran targeted tests: `cd extensions && npx vitest run tests/discovery-routing.test.ts` ✅ (24 passed)
- Ran parser spot-check repros with `npx tsx` against `parsePromptForOrchestrator`

## Blocking findings

### 1) Inline `**Repo:**` parsing is not restricted to front-matter metadata
**Severity:** High

**Where:** `extensions/taskplane/discovery.ts:222-225`

Current code does:
- fallback inline match with `/^\*\*Repo:\*\*\s+(\S+)/m`
- against full `content` (“anywhere in content” per comment)

This means non-metadata lines in later sections can be parsed as routing metadata.

**Repro (observed):**
A prompt with no execution metadata but with:

```md
## Notes
**Repo:** should-not-parse
```

returns `promptRepoId = "should-not-parse"`.

This conflicts with Step 0 grammar in `STATUS.md` (“inline field in front-matter area”) and can route a task to the wrong repo.

**Required fix:**
- Scope inline matching to front-matter only (e.g., pre-heading metadata block before first `##` section), not entire document.
- Add regression test: `**Repo:**` under `## Notes`/`## Steps` must not set `promptRepoId`.

---

### 2) Section precedence is bypassed when section value is invalid
**Severity:** Medium

**Where:** `extensions/taskplane/discovery.ts:193-233`

The code only blocks inline fallback when `promptRepoId` is already set. If `## Execution Target` exists but its `Repo:` value is invalid, `promptRepoId` stays undefined and inline fallback is used.

That contradicts declared precedence (“section-based wins over inline if both present”) and can silently mask invalid section metadata.

**Repro (observed):**
- Inline: `**Repo:** inline`
- Section: `## Execution Target` + `Repo: invalid_repo`
- Result: `promptRepoId = "inline"`

**Required fix:**
- Track section presence separately from parsed validity.
- If section exists and includes a `Repo:` declaration, inline should not override it (unless this fallback is intentionally desired and explicitly documented).
- Add regression test for “invalid section repo + valid inline repo”.

## Non-blocking note
- `types.ts` change (`ParsedTask.promptRepoId?: string`) is clean and aligns with Step 0’s data-contract split.
