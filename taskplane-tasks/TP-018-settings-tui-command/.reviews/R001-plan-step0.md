## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 plan is too thin for a safe handoff into design/implementation. It captures two read tasks, but it misses required context and key preflight outcomes needed to prevent layer-mapping and write-target mistakes in `/settings`. Tightening preflight now will reduce rework in Steps 1–3.

### Issues Found
1. **[Severity: important]** — Required context intake is missing from the plan. `PROMPT.md` explicitly calls out `taskplane-tasks/CONTEXT.md` and related context-first reading (`PROMPT.md:34-41`), but Step 0 in `STATUS.md` only lists two items (`STATUS.md:20-21`). Add a preflight outcome that confirms context docs were reviewed and any constraints were captured.
2. **[Severity: important]** — Layer 2 schema and allowlist behavior are not included in preflight scope. The task depends on TP-017 (`PROMPT.md:31-32`) and user-preference boundaries are defined in `config-schema.ts:333-389` and enforced in `config-loader.ts:467-525`. Without explicitly reviewing these now, Step 1/2 can misclassify editable fields or write preferences incorrectly.
3. **[Severity: minor]** — Preflight has no explicit output artifact. Step 0 should produce a compact field/source inventory (field type + UI control + layer + write target) so Step 1 has deterministic input rather than re-deriving assumptions.

### Missing Items
- Preflight check for config root/path semantics in workspace mode (`config-loader.ts:543-557`) to avoid writing Layer 1 to the wrong repo root.
- Preflight check for JSON-first + YAML fallback behavior (`config-loader.ts` loaders + `PROMPT.md:83-84`) so write-back and tests align with expected format handling.
- A documented list of `ctx.ui` capability constraints relevant to validation and navigation decisions.

### Suggestions
- Add one Step 0 deliverable in `STATUS.md` notes/discoveries: “Preflight findings” with links to exact source files.
- When Step 0 is complete, record at least one discovery entry capturing Layer 1 vs Layer 2 writable fields for downstream steps.
