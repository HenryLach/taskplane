## Plan Review: Step 2: Onboarding Flow (Scripts 1-5)

### Verdict: REVISE

### Summary
The Step 2 plan captures the broad onboarding themes, but it currently under-specifies two required outcomes from the task prompt/spec: onboarding-specific supervisor guidance and explicit Script 1/2/3 trigger handling. As written, it risks delivering a single generic onboarding conversation rather than the script-driven behavior required by TP-042. Tightening these outcome-level items now should prevent rework in implementation and follow-up reviews.

### Issues Found
1. **[Severity: important]** — The plan omits the explicit outcome **"Supervisor prompt includes onboarding script guidance from the primer"** (`PROMPT.md:89`). Step 2 in `STATUS.md` only lists five coarse items (`STATUS.md:35-39`), and there is no explicit prompt/primer onboarding outcome. Without this, routing-mode activation can still operate with the batch-monitoring prompt shape (`extensions/taskplane/supervisor.ts:388,426`), which is misaligned with onboarding conversations.
   **Suggested fix:** Add a Step 2 outcome for onboarding-aware system prompt behavior and primer updates covering Scripts 1-5.

2. **[Severity: important]** — The plan does not explicitly cover **Script trigger differentiation** across Script 1 (first time), Script 2 (new/empty project), and Script 3 (established project), even though Step 2 is scoped to Scripts 1-5 (`PROMPT.md:33,86`). Current wording (`STATUS.md:35`) can be satisfied by a single generic analysis path. The spec requires different triggers/goals for Script 2 vs 3 (`watchdog-and-recovery-tiers.md:1132,1188`).
   **Suggested fix:** Add an outcome for repo maturity classification and explicit routing/delegation among Scripts 1-3, with Scripts 4-5 invoked as delegated subflows.

3. **[Severity: important]** — "Config generation" is currently too underspecified versus the required artifact set (`PROMPT.md:92`). `STATUS.md:38` does not explicitly commit to generating all required files (JSON config, CONTEXT docs, `.pi/agents/` overrides, `.gitignore` updates), which risks partial onboarding completion.
   **Suggested fix:** Expand the Step 2 outcome to list the required generated artifacts and their target roots.

### Missing Items
- Explicit onboarding prompt/primer integration outcome (not just conversation flow outcomes).
- Explicit Script 1/2/3 trigger-based branching outcome.
- Explicit required artifact list for config/scaffolding generation.

### Suggestions
- Reuse existing `taskplane init` scaffolding conventions for file shape/content to avoid drift between interactive onboarding and non-interactive bootstrap.
- Define graceful fallback behavior when GitHub CLI/protection APIs are unavailable (continue onboarding with local git evidence only).
