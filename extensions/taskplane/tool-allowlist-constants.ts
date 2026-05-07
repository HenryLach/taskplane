/**
 * Lightweight, import-free constants module for the worker tool allowlist.
 *
 * This module exists so that pure-data layers (`config-schema.ts`,
 * `types.ts`) can reference the canonical `DEFAULT_WORKER_USER_TOOLS`
 * literal without pulling `agent-host.ts`'s heavy `child_process` / `fs`
 * imports into the schema/types graph (which would either be circular
 * or pull subprocess plumbing into pure-data files).
 *
 * **Strict invariant:** this module MUST NOT have any imports beyond
 * TypeScript built-ins. Anything more would re-introduce the very
 * coupling this module exists to break.
 *
 * The companion `agent-host.ts` re-exports `DEFAULT_WORKER_USER_TOOLS`
 * from this module for backward compatibility — existing internal
 * imports (e.g., `execution.ts`, `worker-tools-allowlist.test.ts`)
 * continue to work via the agent-host re-export. New code may import
 * from either location; this module is the source of truth.
 *
 * `ENGINE_BRIDGE_TOOLS` and the `buildWorkerToolsAllowlist()` helper
 * remain in `agent-host.ts` because that's where their consumers live
 * and there is no duplication problem to solve for them.
 *
 * @module taskplane/tool-allowlist-constants
 * @since TP-189 (Cluster B)
 */

/**
 * Default user-tools portion of the worker `--tools` allowlist. This is the
 * fallback used when neither `taskRunner.worker.tools` config nor the
 * `TASKPLANE_WORKER_TOOLS` env var supplies a value. Engine bridge tools
 * (review_step, notify_supervisor, escalate_to_supervisor,
 * request_segment_expansion) are appended on top by
 * `buildWorkerToolsAllowlist()` at the spawn site — they are NOT part of
 * this default and should not be added by callers.
 */
export const DEFAULT_WORKER_USER_TOOLS = "read,write,edit,bash,grep,find,ls";
