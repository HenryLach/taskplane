## Plan Review: Step 6: Testing & Verification

### Verdict: REVISE

### Summary
The Step 6 plan is currently too thin for the risk and breadth of the init-v2 changes. In `STATUS.md`, Step 6 only lists two broad checks (`STATUS.md:95-99`), which is not enough to verify the many mode branches and recent regression fixes in `bin/taskplane.mjs`. The plan should be expanded to define clear outcome-level test coverage and required validation commands.

### Issues Found
1. **[Severity: important]** — The plan omits an explicit outcome for the required prompt command `node bin/taskplane.mjs init --dry-run --force` (`PROMPT.md:95`). Step 6 currently tracks only two items (`STATUS.md:98-99`), so prompt compliance is not auditable.
2. **[Severity: important]** — The plan does not include minimum project validation commands for CLI changes (`AGENTS.md:87-90`): `cd extensions && npx vitest run`, `node bin/taskplane.mjs help`, and `node bin/taskplane.mjs doctor`. Without these, Step 6 can report complete while missing baseline regressions.
3. **[Severity: important]** — The testing outcomes are not specific enough to protect known risk areas in this task. There is no explicit regression intent for recent fixes in mode and workspace branches (e.g., ambiguous mode handling and Scenario D pointer behavior in `bin/taskplane.mjs:977-1085`, workspace gitignore/artifact cleanup path in `bin/taskplane.mjs:1281-1298`), and no explicit plan to add/initiate init-focused automated coverage despite the noted discovery that none currently exists (`STATUS.md:143`).

### Missing Items
- A scenario matrix with explicit pass criteria for Scenario A/B/C/D in dry-run mode (inputs/topology + expected mode + expected files/messages).
- Edge-case matrix for ambiguity and safety paths: ambiguous topology defaulting in non-interactive mode, no-repo error path, `--force` with existing workspace config (Scenario D), malformed pointer overwrite behavior.
- Explicit compatibility checks for constraints in `PROMPT.md:128-129` (presets still work; YAML output still generated alongside JSON).
- Required validation commands and where they are run (repo root vs `extensions/`).

### Suggestions
- Keep the checklist outcome-level, but expand Step 6 to ~4–6 outcomes that name scenario coverage, edge/regression coverage, and command-level validation gates.
- Add at least one automated init-focused regression test file (or a documented CLI test harness) so future changes don’t rely only on manual dry-run checks.
