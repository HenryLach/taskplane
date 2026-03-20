## Plan Review: Step 1: Implement Force-Resume Policy

### Verdict: REVISE

### Summary
The Step 1 plan captures the main outcomes (flag parsing, diagnostics, force-intent persistence, and eligibility changes), and the Step 0 notes identify useful insertion points. However, the current plan is still missing two critical behavior contracts that are needed to keep resume deterministic and safe in workspace mode. Add those outcome-level details plus explicit test intent for failure paths before implementation.

### Issues Found
1. **[Severity: important]** — The plan does not define the failure-path contract for pre-resume diagnostics.
   - Evidence: `STATUS.md:30-33` lists diagnostics + force intent + matrix, but does not state what must happen when diagnostics fail.
   - Requirement anchor: roadmap says reset to `paused` **only after diagnostics pass** (`docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:507-510`).
   - Suggested fix: explicitly require that failed diagnostics must (a) abort resume, (b) leave resumability intact (no terminal trap), and (c) avoid persisting `resilience.resumeForced=true` unless force-resume is actually accepted.

2. **[Severity: important]** — Workspace/polyrepo diagnostic scope is not called out.
   - Evidence: Step 1 says “pre-resume diagnostics” (`STATUS.md:31`) but does not specify repo coverage.
   - Code context: resume logic is already repo-aware (`extensions/taskplane/resume.ts:41-57`, `:76-89`), so diagnostics should be too.
   - Suggested fix: add an explicit outcome that diagnostics run across all repos referenced by persisted lanes (not just `cwd`), with repo-scoped findings in error output.

3. **[Severity: minor]** — Test intent for Step 1 edge cases is underspecified.
   - Evidence: global Step 4 tests exist (`STATUS.md:56-60`) but Step 1 plan does not call out parser/error-path behaviors.
   - Suggested fix: add targeted intent for at least: unknown `/orch-resume` flags rejection, `failed/stopped` rejection without `--force` (with guidance), and diagnostics-fail force-resume rejection.

### Missing Items
- Explicit non-happy-path outcome for diagnostics failure (state mutation ordering and rejection behavior).
- Explicit workspace-mode scope for diagnostics (all affected repo roots).
- Explicit UX outcome for non-force resume on `failed/stopped` (message should point to `--force` path).

### Suggestions
- Reuse the existing argument-parsing pattern used by `/orch-integrate` (`extensions/taskplane/extension.ts:71-90`) so `/orch-resume` handles unknown flags deterministically.
- Add a short Step 1 note in `STATUS.md` defining when `resumeForced` should be true vs false for subsequent resumes.
