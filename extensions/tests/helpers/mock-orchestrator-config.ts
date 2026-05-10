/**
 * Test helper: produce a fully-populated `OrchestratorConfig` / `TaskRunnerConfig`
 * mock with the option to override individual sections.
 *
 * @module tests/helpers/mock-orchestrator-config
 * @since TP-195 — introduced to dedupe the mock-object missing-fields
 *   churn flagged by `npm run typecheck` (~50% of the TS2741/TS2739 errors
 *   on the test side were mock objects rebuilding partial `OrchestratorConfig`
 *   shapes that drift away from the canonical schema in
 *   `extensions/taskplane/types.ts`).
 *
 * **Default values are schema-sourced.** This file re-exports
 * `DEFAULT_ORCHESTRATOR_CONFIG` and `DEFAULT_TASK_RUNNER_CONFIG` from
 * `extensions/taskplane/types.ts` so the canonical defaults never drift
 * away from runtime expectations. Tests pass their own overrides where
 * they need to assert on specific values; everything else is inherited.
 *
 * **Anti-shortcut policy:** these factories MUST NOT use `as any` or
 * garbage default values. Every returned object is fully type-correct
 * against the current `OrchestratorConfig` / `TaskRunnerConfig` shapes.
 */
import {
	DEFAULT_ORCHESTRATOR_CONFIG,
	DEFAULT_TASK_RUNNER_CONFIG,
	type OrchestratorConfig,
	type TaskRunnerConfig,
} from "../../taskplane/types.ts";

/**
 * Deep-merge override values onto a base config. Top-level fields take
 * either a full section value (overriding the default entirely) or a
 * partial section value (merged shallowly into the default).
 *
 * Limitation: only one level of nesting is merged. For deeper overrides
 * (e.g., `orchestrator.spawn_mode` while keeping other `orchestrator` fields),
 * pass the full `orchestrator` section with the modified value. This keeps
 * the helper simple and avoids surprising deep-merge semantics in tests.
 */
type SectionOverride<T> = Partial<{ [K in keyof T]: Partial<T[K]> | T[K] }>;

/**
 * Build a fully-populated `OrchestratorConfig` for use in tests.
 *
 * Defaults come from `DEFAULT_ORCHESTRATOR_CONFIG`. Overrides are merged
 * one level deep — pass `{ orchestrator: { max_lanes: 5 } }` to override
 * just `max_lanes` while keeping all other orchestrator fields at their
 * schema defaults.
 */
export function makeOrchestratorConfig(
	overrides: SectionOverride<OrchestratorConfig> = {},
): OrchestratorConfig {
	const base = DEFAULT_ORCHESTRATOR_CONFIG;
	return {
		orchestrator: { ...base.orchestrator, ...(overrides.orchestrator ?? {}) },
		dependencies: { ...base.dependencies, ...(overrides.dependencies ?? {}) },
		assignment: { ...base.assignment, ...(overrides.assignment ?? {}) },
		pre_warm: { ...base.pre_warm, ...(overrides.pre_warm ?? {}) },
		merge: { ...base.merge, ...(overrides.merge ?? {}) },
		failure: { ...base.failure, ...(overrides.failure ?? {}) },
		monitoring: { ...base.monitoring, ...(overrides.monitoring ?? {}) },
		verification: { ...base.verification, ...(overrides.verification ?? {}) },
	};
}

/**
 * Build a `TaskRunnerConfig` for use in tests. Mirrors the runtime
 * defaults from `DEFAULT_TASK_RUNNER_CONFIG`; overrides are shallow.
 */
export function makeTaskRunnerConfig(overrides: Partial<TaskRunnerConfig> = {}): TaskRunnerConfig {
	return {
		...DEFAULT_TASK_RUNNER_CONFIG,
		...overrides,
	};
}
