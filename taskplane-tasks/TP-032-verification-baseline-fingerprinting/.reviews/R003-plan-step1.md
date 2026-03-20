## Plan Review: Step 1: Verification Command Runner & Fingerprint Parser

### Verdict: REVISE

### Summary
The Step 1 plan captures the right high-level outcomes, but it is still too thin for a merge-gate feature where false positives/false negatives directly affect lane advancement. The current checklist in `STATUS.md` lists function names only (`STATUS.md:27-30`) and does not yet define key behavioral contracts needed for deterministic baseline diffing in Step 2. Tightening those contracts now will reduce rework and flaky merge decisions.

### Issues Found
1. **[Severity: important]** — Runner output contract is not defined beyond “execute configured commands.”  
   `STATUS.md:28` + `PROMPT.md:64` do not specify what `runVerificationCommands()` returns per command (exit code, stdout/stderr capture, timeout/error classification, command ordering). Step 2 flaky reruns and merge blocking depend on this (`PROMPT.md:80`).  
   **Suggested fix:** Add explicit Step 1 outcome for a typed per-command result shape (including `commandId`, exit status, output/error fields, and deterministic iteration order from `testing.commands`).

2. **[Severity: important]** — `messageNorm` normalization rules are unspecified, risking unstable fingerprints across runs.  
   `STATUS.md:29-30` and `PROMPT.md:66-67` require normalized fingerprints, but the plan does not define normalization behavior (ANSI stripping, whitespace collapsing, path separator normalization, volatile token handling). Without this, pre-existing failures may be misclassified as new failures.
   **Suggested fix:** Add concrete normalization rules and a “stable key” definition used by `diffFingerprints()`.

3. **[Severity: important]** — No fallback behavior is planned for non-JSON or partially malformed test output.  
   The plan mentions vitest JSON adapter (`STATUS.md:29`) but does not cover command failures where JSON is missing/truncated. In those paths, baseline/post-merge comparison still needs a deterministic fingerprint to avoid silent pass-through.
   **Suggested fix:** Define parser fallback classification (e.g., `kind: "command_error"`) with bounded raw message extraction when structured parsing fails.

4. **[Severity: minor]** — Diff semantics are underspecified (set-vs-multiset, dedup strategy).  
   `STATUS.md:30` says “new failures only” but does not define equality/dedup rules for repeated assertion messages in a single run.
   **Suggested fix:** Specify equality key fields and whether duplicates are collapsed before subtraction.

### Missing Items
- Step 1 test coverage intent for runner failure paths (non-zero exit, timeout, malformed JSON, empty command map, duplicate fingerprints).
- Explicit API boundaries for `verification.ts` exports that Step 2 will consume (types/interfaces, not just function names).

### Suggestions
- Add a short “Step 1 Design Notes” subsection in `STATUS.md` with the runner result schema and fingerprint equality key before implementation.
- Clean up duplicated execution-log rows (`STATUS.md:116-119`) to keep review/audit history unambiguous.
