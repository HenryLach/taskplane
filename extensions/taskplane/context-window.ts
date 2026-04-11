/**
 * Context Window Resolution Utilities
 *
 * Canonical home for context window resolution logic used when spawning workers.
 *
 * The original `resolveContextWindow(config: TaskConfig, ctx: ExtensionContext)` signature
 * has been adapted to accept only the fields it actually uses, avoiding a dependency
 * on the task-runner-internal `TaskConfig` type. Behavior is identical.
 *
 * @since TP-161
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// ── Context Window Constants ──────────────────────────────────────────

/** Default fallback context window when neither config nor model provides a value. */
export const FALLBACK_CONTEXT_WINDOW: number = 200_000;

// ── Context Window Resolution ─────────────────────────────────────────

/**
 * Resolve the effective context window size for worker spawning.
 *
 * Resolution order (first non-zero value wins):
 *   1. Explicit user config (configuredWindow > 0)
 *   2. Auto-detect from pi model registry (ctx.model.contextWindow)
 *   3. Fallback to 200K tokens
 *
 * A configuredWindow of 0 (or undefined) signals "auto-detect" — the default
 * when no explicit value is configured. This allows pi's model registry to
 * provide the real context window for the active model.
 *
 * @param configuredWindow - The `worker_context_window` from config (0 = auto-detect)
 * @param ctx - The pi ExtensionContext for model registry auto-detection, or null
 * @returns Object with `contextWindow` (resolved size) and `source` (diagnostic label)
 *
 * @example
 * // With explicit config
 * resolveContextWindow(500_000, ctx) // → { contextWindow: 500000, source: "explicit config" }
 *
 * // With auto-detect (config = 0)
 * resolveContextWindow(0, ctx) // → { contextWindow: 200000, source: "auto-detected from anthropic/claude-opus-4-6" }
 *
 * // With fallback (no config, no model)
 * resolveContextWindow(undefined, null) // → { contextWindow: 200000, source: "fallback 200000" }
 */
export function resolveContextWindow(
	configuredWindow: number | undefined,
	ctx: ExtensionContext | null,
): { contextWindow: number; source: string } {
	// 1. Explicit user config — non-zero means the user set it deliberately
	if (configuredWindow && configuredWindow > 0) {
		return { contextWindow: configuredWindow, source: "explicit config" };
	}

	// 2. Auto-detect from pi model registry
	const modelWindow = ctx?.model?.contextWindow;
	if (modelWindow && modelWindow > 0) {
		const modelId = ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		return { contextWindow: modelWindow, source: `auto-detected from ${modelId}` };
	}

	// 3. Fallback
	return { contextWindow: FALLBACK_CONTEXT_WINDOW, source: `fallback ${FALLBACK_CONTEXT_WINDOW}` };
}
