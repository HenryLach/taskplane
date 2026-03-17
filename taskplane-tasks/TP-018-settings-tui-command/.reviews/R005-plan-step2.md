## Plan Review: Step 2: Implement /settings Command

### Verdict: REVISE

### Summary
Step 1 gives a strong field/source design, but the actual Step 2 plan is still too high-level to safely execute. The current checklist does not yet cover root-resolution constraints, forward-schema discoverability guarantees, or concrete validation behavior for interactive edits. Tightening these outcome-level items now will reduce churn in Steps 3–4.

### Issues Found
1. **[Severity: important]** — Step 2 outcomes are too generic (`taskplane-tasks/TP-018-settings-tui-command/STATUS.md:45-47`) to protect against existing root-handling constraints in `extension.ts` and tests. `workspace-config.test.ts` currently enforces very strict `ctx.cwd` usage patterns (`extensions/tests/workspace-config.test.ts:669-681`), and `extension.ts` already routes filesystem-aware commands through execution context (`extensions/taskplane/extension.ts:83-91,656-666`). **Suggested fix:** add an explicit Step 2 outcome for `/settings` root resolution and command guard behavior (e.g., use execCtx-derived roots/shared resolver, avoid new direct `ctx.cwd` usage unless tests are intentionally updated).
2. **[Severity: important]** — The plan does not yet guarantee the requirement that new schema parameters are automatically discoverable (`PROMPT.md:25-26,106`). The documented navigation/advanced field lists are still manual enumerations (`STATUS.md:303-340,447-480`). **Suggested fix:** add a Step 2 outcome that defines how unknown/new fields are surfaced dynamically (for example, schema/default-object traversal with automatic fallback into Advanced read-only rows).
3. **[Severity: important]** — “Field editing with validation” remains underspecified (`STATUS.md:46`). Current loader validation is primarily JSON parse/version checks (`extensions/taskplane/config-loader.ts:265-317`) and does not define UI-time numeric/range/empty-state handling. **Suggested fix:** add a compact validation contract for Step 2 (enum whitelist, number parsing and bounds, optional unset behavior, and user-visible error handling/retry path).

### Missing Items
- Explicit decision for `/settings` behavior when `execCtx` is null after workspace startup failure (`extensions/taskplane/extension.ts:83-91,656-672`).
- Explicit outcome for runtime coherence after edits (whether in-memory `orchConfig`/`runnerConfig` are refreshed immediately or only after session restart).
- Step 2 test-intent bullets for high-risk cases already identified in discoveries (`STATUS.md:95`): 12-section rendering, empty-string preference fallback, and worker `(inherit)` semantics.

### Suggestions
- Add a short “Step 2 implementation contract” block under the Step 2 checklist in `STATUS.md` with: command flow, root source, validation rules, and post-edit refresh policy.
- Keep Step 2 scoped to UI + validation + provenance display; defer file writes to Step 3, but define the integration seam now.
