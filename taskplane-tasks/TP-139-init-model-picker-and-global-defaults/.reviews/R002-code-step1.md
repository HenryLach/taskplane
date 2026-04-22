## Code Review: Step 1: Model registry access from CLI

### Verdict: REVISE

### Summary
The model discovery helper and its targeted tests are well-structured and satisfy the core Step 1 outcomes (structured parsing, graceful fallback, timeout/error handling). However, the supporting refactor that gates CLI execution behind `isDirectExecution` introduces a major runtime regression: invoking `taskplane` through a symlink path no longer runs `main()`. Since npm/bin usage commonly involves symlinks (especially on Unix), this blocks approval.

### Issues Found
1. **[bin/taskplane.mjs:2764-2771] [critical]** — Direct-execution detection compares `pathToFileURL(path.resolve(process.argv[1])).href` to `import.meta.url`, which fails when the script is launched via a symlink. In that case `import.meta.url` resolves to the real target path while `argv[1]` remains the symlink path, so `isDirectExecution` is false and the CLI exits silently (status 0, no output).  
   **Repro:** create a symlink to `bin/taskplane.mjs` and run `node <symlink> help` → no output.  
   **Fix:** compare canonical real paths (e.g., `fs.realpathSync(argv1)` vs `fs.realpathSync(fileURLToPath(import.meta.url))`) or another symlink-safe main-module check.

### Pattern Violations
- None.

### Test Gaps
- No test coverage for the new direct-execution guard behavior (especially symlink invocation path). Add a regression test that executes the CLI via a symlink and verifies help output is produced.

### Suggestions
- Consider tightening `parsePiListModelsOutput` to reject obvious non-table text lines (defensive hardening for future `pi --list-models` output changes).
