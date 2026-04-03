/**
 * Task Orchestrator — Parallel task execution with git worktrees
 *
 * This is a thin facade that re-exports everything from the taskplane/ modules.
 * The actual implementation lives in extensions/taskplane/*.ts.
 *
 * Commands:
 *   /orch <areas|paths|all>        — Start batch execution
 *   /orch-plan <areas|paths|all>   — Preview execution plan (no execution)
 *   /orch-status                   — Show current batch progress
 *   /orch-pause                    — Pause after current tasks finish
 *   /orch-resume                   — Resume a paused batch
 *   /orch-abort [--hard]           — Abort batch (graceful or immediate)
 *   /orch-deps <areas|paths|all>   — Show dependency graph
 *   /orch-sessions                 — List active lane sessions
 *
 * Configuration:
 *   .pi/task-orchestrator.yaml  — orchestrator-specific settings
 *   .pi/task-runner.yaml        — task areas, worker/reviewer config (shared)
 *
 * Usage: pi -e extensions/task-orchestrator.ts -e extensions/task-runner.ts
 */

// Re-export all named exports for tests and other consumers
export * from "./taskplane/index.ts";

// Re-export the default activate function for the pi extension system
export { default } from "./taskplane/extension.ts";
