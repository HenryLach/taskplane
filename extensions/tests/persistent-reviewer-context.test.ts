/**
 * Persistent Reviewer Context — TP-057
 *
 * Tests for the persistent reviewer model:
 *   1.x — reviewer-extension.ts: wait_for_review tool structure
 *   2.x — Signal protocol: numbering, content mapping, shutdown detection
 *   3.x — Stale signal cleanup before spawn
 *   4.x — Session reuse: persistent reviewer spawns once, reused on subsequent calls
 *   5.x — Fallback: dead session detected → fresh spawn
 *   6.x — Centralized shutdown: shutdownPersistentReviewer on all exit paths
 *   7.x — Reviewer template: persistent and fresh spawn mode support
 *   8.x — Path resolution and package inclusion
 *   9.x — State management: persistentReviewerSession, signal counter, kill function
 *  10.x — Token accumulation: cumulative across persistent reviews
 *
 * Run: npx vitest run tests/persistent-reviewer-context.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Source Loading ───────────────────────────────────────────────────

const taskRunnerSource = readFileSync(join(__dirname, "..", "task-runner.ts"), "utf8");
const reviewerExtSource = readFileSync(join(__dirname, "..", "reviewer-extension.ts"), "utf8");
const typesSource = readFileSync(join(__dirname, "..", "taskplane", "types.ts"), "utf8");

/**
 * Extract a function body from source by name.
 * Works for both `function foo(` and `async function foo(`.
 */
function extractFunction(src: string, name: string): string {
	const pattern = new RegExp(`(async\\s+)?function ${name}\\s*[<(]`);
	const match = pattern.exec(src);
	if (!match) throw new Error(`Function '${name}' not found in source`);

	let depth = 0;
	let started = false;
	const start = match.index;

	for (let i = match.index; i < src.length; i++) {
		if (src[i] === "{") {
			depth++;
			started = true;
		}
		if (src[i] === "}") {
			depth--;
			if (started && depth === 0) {
				return src.slice(start, i + 1);
			}
		}
	}

	throw new Error(`Could not find end of function '${name}'`);
}

/**
 * Get the region of source code around a specific pattern.
 */
function sourceRegion(src: string, pattern: string, beforeChars = 0, afterChars = 1000): string {
	const idx = src.indexOf(pattern);
	if (idx === -1) throw new Error(`Pattern not found: ${pattern}`);
	return src.slice(Math.max(0, idx - beforeChars), idx + pattern.length + afterChars);
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — reviewer-extension.ts: wait_for_review tool structure
// ══════════════════════════════════════════════════════════════════════

describe("1.x: reviewer-extension.ts — wait_for_review tool structure", () => {
	it("1.1: extension registers wait_for_review tool", () => {
		expect(reviewerExtSource).toContain('name: "wait_for_review"');
		expect(reviewerExtSource).toContain("pi.registerTool(");
	});

	it("1.2: tool has empty parameters (no arguments needed)", () => {
		expect(reviewerExtSource).toContain("parameters: Type.Object({})");
	});

	it("1.3: tool reads REVIEWER_SIGNAL_DIR from environment", () => {
		expect(reviewerExtSource).toContain("process.env.REVIEWER_SIGNAL_DIR");
	});

	it("1.4: tool skips registration when REVIEWER_SIGNAL_DIR is not set", () => {
		// When env var is missing, extension returns early without registering
		expect(reviewerExtSource).toContain("if (!signalDir)");
		// The return happens before registerTool
		const envCheck = reviewerExtSource.indexOf("if (!signalDir)");
		const registerTool = reviewerExtSource.indexOf("pi.registerTool(");
		expect(envCheck).toBeLessThan(registerTool);
	});

	it("1.5: tool tracks a monotonically increasing signal counter", () => {
		expect(reviewerExtSource).toContain("let nextSignalNum = 1");
		expect(reviewerExtSource).toContain("nextSignalNum++");
	});

	it("1.6: tool imports polling constants from types.ts", () => {
		expect(reviewerExtSource).toContain("REVIEWER_POLL_INTERVAL_MS");
		expect(reviewerExtSource).toContain("REVIEWER_WAIT_TIMEOUT_MS");
		expect(reviewerExtSource).toContain("REVIEWER_SHUTDOWN_SIGNAL");
		expect(reviewerExtSource).toContain("REVIEWER_SIGNAL_PREFIX");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Signal protocol: numbering, content mapping, shutdown
// ══════════════════════════════════════════════════════════════════════

describe("2.x: Signal protocol — numbering, content mapping, shutdown", () => {
	it("2.1: signal files use 3-digit zero-padded numbering", () => {
		// In reviewer-extension: signalNum is padded to 3 digits
		expect(reviewerExtSource).toContain('.padStart(3, "0")');
		// In task-runner: same padding
		expect(taskRunnerSource).toContain('String(state.persistentReviewerSignalNum).padStart(3, "0")');
	});

	it("2.2: signal file content contains the request filename (decoupled numbering)", () => {
		// Task-runner writes the request filename into the signal file
		const signalFn = sourceRegion(taskRunnerSource, "function signalPersistentReviewer", 0, 500);
		expect(signalFn).toContain("writeFileSync(signalPath,");
		expect(signalFn).toContain("request-R${num}.md");
	});

	it("2.3: reviewer reads signal content to find request file (not derived from signal number)", () => {
		// Reviewer reads signal file content, not deriving from signal number
		expect(reviewerExtSource).toContain("readFileSync(signalPath");
		expect(reviewerExtSource).toContain("const signalContent = readFileSync(signalPath");
		expect(reviewerExtSource).toContain("const requestPath = join(signalDir, signalContent)");
	});

	it("2.4: shutdown signal uses .review-shutdown marker file", () => {
		expect(reviewerExtSource).toContain("REVIEWER_SHUTDOWN_SIGNAL");
		expect(reviewerExtSource).toContain("existsSync(shutdownPath)");
	});

	it("2.5: shutdown returns SHUTDOWN message to reviewer", () => {
		expect(reviewerExtSource).toContain("SHUTDOWN — The task is complete. Exit cleanly.");
	});

	it("2.6: timeout returns TIMEOUT message", () => {
		expect(reviewerExtSource).toContain("TIMEOUT — No review request received within the timeout period.");
	});

	it("2.7: missing request file returns ERROR with descriptive message", () => {
		expect(reviewerExtSource).toContain("ERROR — Signal file");
		expect(reviewerExtSource).toContain("does not exist");
	});

	it("2.8: reviewer checks shutdown before checking signal on each poll iteration", () => {
		// Shutdown check comes before signal check in the polling loop
		const shutdownCheck = reviewerExtSource.indexOf("existsSync(shutdownPath)");
		const signalCheck = reviewerExtSource.indexOf("existsSync(signalPath)");
		expect(shutdownCheck).toBeGreaterThan(0);
		expect(signalCheck).toBeGreaterThan(shutdownCheck);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Stale signal cleanup before spawn
// ══════════════════════════════════════════════════════════════════════

describe("3.x: Stale signal cleanup — cleanStaleReviewerSignals", () => {
	it("3.1: cleanStaleReviewerSignals function exists in task-runner.ts", () => {
		expect(taskRunnerSource).toContain("function cleanStaleReviewerSignals(reviewsDir: string)");
	});

	it("3.2: cleanup removes files matching REVIEWER_SIGNAL_PREFIX", () => {
		const fn = extractFunction(taskRunnerSource, "cleanStaleReviewerSignals");
		expect(fn).toContain("REVIEWER_SIGNAL_PREFIX");
		expect(fn).toContain("unlinkSync");
	});

	it("3.3: cleanup removes REVIEWER_SHUTDOWN_SIGNAL", () => {
		const fn = extractFunction(taskRunnerSource, "cleanStaleReviewerSignals");
		expect(fn).toContain("REVIEWER_SHUTDOWN_SIGNAL");
	});

	it("3.4: cleanup is called before spawning a new persistent reviewer", () => {
		// cleanStaleReviewerSignals is called inside spawnPersistentReviewer
		const spawnFn = sourceRegion(taskRunnerSource, "function spawnPersistentReviewer", 0, 1500);
		expect(spawnFn).toContain("cleanStaleReviewerSignals(reviewsDir)");
	});

	it("3.5: cleanup handles non-existent directory gracefully", () => {
		const fn = extractFunction(taskRunnerSource, "cleanStaleReviewerSignals");
		// The function uses try/catch to handle missing directory
		expect(fn).toContain("catch");
	});

	it("3.6: readdirSync is imported for directory scanning", () => {
		expect(taskRunnerSource).toContain("readdirSync");
		// Verify it's in the fs import
		const fsImport = sourceRegion(taskRunnerSource, 'from "fs"', 200, 10);
		expect(fsImport).toContain("readdirSync");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Session reuse: persistent reviewer spawned once
// ══════════════════════════════════════════════════════════════════════

describe("4.x: Session reuse — persistent reviewer spawned once per task", () => {
	it("4.1: review_step checks for existing persistent session before spawning", () => {
		expect(taskRunnerSource).toContain("!state.persistentReviewerSession || !isPersistentReviewerAlive()");
	});

	it("4.2: isPersistentReviewerAlive checks tmux has-session", () => {
		const fn = sourceRegion(taskRunnerSource, "function isPersistentReviewerAlive", 0, 300);
		expect(fn).toContain('spawnSync("tmux", ["has-session"');
		expect(fn).toContain("result.status === 0");
	});

	it("4.3: persistent reviewer session name is stored in state", () => {
		expect(taskRunnerSource).toContain("state.persistentReviewerSession = sessionName");
	});

	it("4.4: persistent reviewer kill function is stored in state", () => {
		expect(taskRunnerSource).toContain("state.persistentReviewerKill = spawned.kill");
	});

	it("4.5: persistent reviewer promise is NOT awaited (stays alive)", () => {
		// The spawned.promise is handled with .then()/.catch() instead of await
		expect(taskRunnerSource).toContain("spawned.promise.then(() =>");
		expect(taskRunnerSource).toContain("spawned.promise.then");
	});

	it("4.6: subsequent review_step calls only write signal + poll for verdict", () => {
		// After spawn, subsequent calls signal the existing reviewer
		expect(taskRunnerSource).toContain("signalPersistentReviewer()");
		expect(taskRunnerSource).toContain("pollForVerdict()");
	});

	it("4.7: persistent reviewer is spawned with reviewer-extension loaded", () => {
		const spawnFn = sourceRegion(taskRunnerSource, "function spawnPersistentReviewer", 0, 1500);
		expect(spawnFn).toContain("extensions: [reviewerExtPath]");
	});

	it("4.8: REVIEWER_SIGNAL_DIR is passed as env var to the spawned session", () => {
		const spawnFn = sourceRegion(taskRunnerSource, "function spawnPersistentReviewer", 0, 1500);
		expect(spawnFn).toContain("env: { REVIEWER_SIGNAL_DIR: reviewsDir }");
	});

	it("4.9: spawnAgentTmux supports env option for extra environment variables", () => {
		// The env option is injected as shell variable prefix in the tmux command
		expect(taskRunnerSource).toContain("env?: Record<string, string>");
		expect(taskRunnerSource).toContain("extraEnv");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — Fallback: dead session → fresh spawn
// ══════════════════════════════════════════════════════════════════════

describe("5.x: Fallback — dead persistent session triggers fresh spawn", () => {
	it("5.1: dead session is detected on subsequent review_step calls", () => {
		expect(taskRunnerSource).toContain("needsSpawn && state.persistentReviewerSession");
		expect(taskRunnerSource).toContain("persistent reviewer session dead — respawning");
	});

	it("5.2: dead session detection resets persistent state", () => {
		// After detecting dead session, state is reset
		const fallbackRegion = sourceRegion(taskRunnerSource, "persistent reviewer session dead", 50, 500);
		expect(fallbackRegion).toContain("state.persistentReviewerSession = null");
		expect(fallbackRegion).toContain("state.persistentReviewerKill = null");
		expect(fallbackRegion).toContain("state.persistentReviewerSignalNum = 0");
	});

	it("5.3: fallback logs to STATUS.md execution log", () => {
		expect(taskRunnerSource).toContain('logExecution(statusPath, `Reviewer R${num}`');
		expect(taskRunnerSource).toContain("persistent reviewer dead — respawning");
	});

	it("5.4: fallback fresh spawn exists in catch block", () => {
		// The catch block contains a fallback fresh spawn
		expect(taskRunnerSource).toContain("persistent reviewer failed — falling back to fresh spawn");
		expect(taskRunnerSource).toContain("Fresh spawn fallback (original behavior)");
	});

	it("5.5: fallback spawn uses same spawnAgentTmux (without extensions)", () => {
		// The fallback spawn reads request content as prompt (original pattern)
		// The second spawnAgentTmux call in the review_step handler (fallback)
		// uses promptContent from the request file
		expect(taskRunnerSource).toContain("const promptContent = readFileSync(requestPath,");
	});

	it("5.6: fallback logs verdict with (fallback) suffix", () => {
		expect(taskRunnerSource).toContain("${verdict} (fallback)");
	});

	it("5.7: fallback kills broken persistent session before fresh spawn", () => {
		const catchRegion = sourceRegion(taskRunnerSource, "persistent reviewer failed — falling back", 100, 500);
		expect(catchRegion).toContain("persistentReviewerKill");
		expect(catchRegion).toContain("state.persistentReviewerSession = null");
	});

	it("5.8: both persistent and fallback failure returns UNAVAILABLE", () => {
		expect(taskRunnerSource).toContain("both persistent and fallback failed");
		expect(taskRunnerSource).toContain("UNAVAILABLE — reviewer error");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Centralized shutdown on all exit paths
// ══════════════════════════════════════════════════════════════════════

describe("6.x: Centralized shutdown — shutdownPersistentReviewer on all exit paths", () => {
	it("6.1: shutdownPersistentReviewer function exists", () => {
		expect(taskRunnerSource).toContain("async function shutdownPersistentReviewer(reason: string)");
	});

	it("6.2: shutdown writes REVIEWER_SHUTDOWN_SIGNAL file", () => {
		const fn = extractFunction(taskRunnerSource, "shutdownPersistentReviewer");
		expect(fn).toContain("REVIEWER_SHUTDOWN_SIGNAL");
		expect(fn).toContain("writeFileSync");
	});

	it("6.3: shutdown polls for session death within grace period", () => {
		const fn = extractFunction(taskRunnerSource, "shutdownPersistentReviewer");
		expect(fn).toContain("REVIEWER_SHUTDOWN_GRACE_MS");
		expect(fn).toContain('has-session');
	});

	it("6.4: shutdown force-kills session if still alive after grace period", () => {
		const fn = extractFunction(taskRunnerSource, "shutdownPersistentReviewer");
		expect(fn).toContain("kill-session");
	});

	it("6.5: shutdown resets all persistent reviewer state", () => {
		const fn = extractFunction(taskRunnerSource, "shutdownPersistentReviewer");
		expect(fn).toContain("state.persistentReviewerSession = null");
		expect(fn).toContain("state.persistentReviewerKill = null");
		expect(fn).toContain("state.persistentReviewerSignalNum = 0");
		expect(fn).toContain("clearReviewerState()");
	});

	it("6.6: shutdown logs reason to STATUS execution log", () => {
		const fn = extractFunction(taskRunnerSource, "shutdownPersistentReviewer");
		expect(fn).toContain("logExecution");
		expect(fn).toContain("Shutdown complete");
		expect(fn).toContain("reason");
	});

	it("6.7: shutdown is called on normal task completion", () => {
		const executeTaskBody = extractFunction(taskRunnerSource, "executeTask");
		expect(executeTaskBody).toContain('shutdownPersistentReviewer("task complete")');
	});

	it("6.8: shutdown is called on pause", () => {
		const executeTaskBody = extractFunction(taskRunnerSource, "executeTask");
		expect(executeTaskBody).toContain('shutdownPersistentReviewer("task paused")');
	});

	it("6.9: shutdown is called on worker error", () => {
		const executeTaskBody = extractFunction(taskRunnerSource, "executeTask");
		expect(executeTaskBody).toContain('shutdownPersistentReviewer("worker error")');
	});

	it("6.10: shutdown is called on task stall", () => {
		const executeTaskBody = extractFunction(taskRunnerSource, "executeTask");
		expect(executeTaskBody).toContain('shutdownPersistentReviewer("task stalled")');
	});

	it("6.11: shutdown is called on max iterations", () => {
		const executeTaskBody = extractFunction(taskRunnerSource, "executeTask");
		expect(executeTaskBody).toContain('shutdownPersistentReviewer("max iterations reached")');
	});

	it("6.12: shutdown is a no-op when no persistent session exists", () => {
		const fn = extractFunction(taskRunnerSource, "shutdownPersistentReviewer");
		expect(fn).toContain("if (!state.persistentReviewerSession) return");
	});

	it("6.13: persistent reviewer is also killed in the global cleanup handler", () => {
		// The existing cleanup handler (for abort/kill scenarios) also cleans up
		expect(taskRunnerSource).toContain("if (state.persistentReviewerKill) try { state.persistentReviewerKill(); } catch {}");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — Reviewer template: dual-mode support
// ══════════════════════════════════════════════════════════════════════

describe("7.x: Reviewer template — persistent and fresh spawn modes", () => {
	const templatePath = join(__dirname, "..", "..", "templates", "agents", "task-reviewer.md");
	let templateContent: string;

	try {
		templateContent = readFileSync(templatePath, "utf8");
	} catch {
		templateContent = "";
	}

	it("7.1: template describes persistent mode with wait_for_review", () => {
		expect(templateContent).toContain("wait_for_review");
		expect(templateContent).toContain("Persistent Mode");
	});

	it("7.2: template describes fresh spawn mode (fallback)", () => {
		expect(templateContent).toContain("Fresh Spawn Mode");
	});

	it("7.3: template instructs mode detection based on tool availability", () => {
		expect(templateContent).toContain("wait_for_review");
		// Both modes are documented with clear conditions
		expect(templateContent).toContain("when `wait_for_review` tool is available");
		expect(templateContent).toContain("when `wait_for_review` is NOT available");
	});

	it("7.4: template instructs cross-step awareness in persistent mode", () => {
		expect(templateContent).toContain("Cross-step awareness");
		expect(templateContent).toContain("reference your earlier");
	});

	it("7.5: template preserves existing verdict format", () => {
		expect(templateContent).toContain("APPROVE");
		expect(templateContent).toContain("REVISE");
		expect(templateContent).toContain("RETHINK");
	});

	it("7.6: template preserves the critical write-to-disk rule", () => {
		expect(templateContent).toContain("CRITICAL");
		expect(templateContent).toContain("write");
		expect(templateContent).toContain("output file");
	});

	it("7.7: template mentions SHUTDOWN signal handling in persistent mode", () => {
		expect(templateContent).toContain("SHUTDOWN");
		expect(templateContent).toContain("exit cleanly");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 8.x — Path resolution and package inclusion
// ══════════════════════════════════════════════════════════════════════

describe("8.x: Path resolution and package inclusion", () => {
	it("8.1: resolveReviewerExtensionPath function exists in task-runner.ts", () => {
		expect(taskRunnerSource).toContain("function resolveReviewerExtensionPath()");
	});

	it("8.2: resolveReviewerExtensionPath checks package root first", () => {
		const fn = extractFunction(taskRunnerSource, "resolveReviewerExtensionPath");
		expect(fn).toContain("findPackageRoot()");
	});

	it("8.3: resolveReviewerExtensionPath resolves reviewer-extension.ts path", () => {
		const fn = extractFunction(taskRunnerSource, "resolveReviewerExtensionPath");
		expect(fn).toContain("reviewer-extension.ts");
	});

	it("8.4: resolveReviewerExtensionPath returns null on failure (not throw)", () => {
		const fn = extractFunction(taskRunnerSource, "resolveReviewerExtensionPath");
		expect(fn).toContain("return null");
	});

	it("8.5: reviewer-extension.ts is included in package.json files", () => {
		const pkgPath = join(__dirname, "..", "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
		expect(pkg.files).toContain("extensions/reviewer-extension.ts");
	});

	it("8.6: reviewer-extension.ts file exists", () => {
		const extPath = join(__dirname, "..", "reviewer-extension.ts");
		expect(existsSync(extPath)).toBe(true);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 9.x — State management: persistent reviewer fields
// ══════════════════════════════════════════════════════════════════════

describe("9.x: State management — persistent reviewer fields in TaskState", () => {
	it("9.1: TaskState includes persistentReviewerSession field", () => {
		expect(taskRunnerSource).toContain("persistentReviewerSession: string | null");
	});

	it("9.2: TaskState includes persistentReviewerKill field", () => {
		expect(taskRunnerSource).toContain("persistentReviewerKill: (() => void) | null");
	});

	it("9.3: TaskState includes persistentReviewerSignalNum field", () => {
		expect(taskRunnerSource).toContain("persistentReviewerSignalNum: number");
	});

	it("9.4: freshState initializes persistent reviewer fields to null/0", () => {
		expect(taskRunnerSource).toContain("persistentReviewerSession: null");
		expect(taskRunnerSource).toContain("persistentReviewerKill: null");
		expect(taskRunnerSource).toContain("persistentReviewerSignalNum: 0");
	});

	it("9.5: signal counter increments on each signalPersistentReviewer call", () => {
		const fn = sourceRegion(taskRunnerSource, "function signalPersistentReviewer", 0, 500);
		expect(fn).toContain("state.persistentReviewerSignalNum++");
	});

	it("9.6: signal counter resets to 0 on session death/respawn", () => {
		// Multiple places reset the counter
		const deadSessionRegion = sourceRegion(taskRunnerSource, "persistent reviewer session dead", 0, 300);
		expect(deadSessionRegion).toContain("state.persistentReviewerSignalNum = 0");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 10.x — Token accumulation across persistent reviews
// ══════════════════════════════════════════════════════════════════════

describe("10.x: Token accumulation — cumulative across persistent reviews", () => {
	it("10.1: token counts are NOT reset when persistent session exists", () => {
		// The conditional guards the token reset — only reset when no persistent session
		expect(taskRunnerSource).toContain("Don't reset cumulative token counts for persistent reviewer");
		const conditional = sourceRegion(taskRunnerSource, "Don't reset cumulative token counts for persistent reviewer", 0, 500);
		expect(conditional).toContain("if (!state.persistentReviewerSession)");
		expect(conditional).toContain("state.reviewerInputTokens = 0");
		expect(conditional).toContain("state.reviewerOutputTokens = 0");
	});

	it("10.2: telemetry callback accumulates tokens (not replaces)", () => {
		expect(taskRunnerSource).toContain("state.reviewerInputTokens += delta.inputTokens");
		expect(taskRunnerSource).toContain("state.reviewerOutputTokens += delta.outputTokens");
	});

	it("10.3: reviewer status is set to idle (not cleared) after persistent review", () => {
		// After a persistent review completes, status goes to idle (not fully cleared)
		const idleRegion = sourceRegion(taskRunnerSource, "Set reviewer to idle (NOT clear", 0, 200);
		expect(idleRegion).toContain('state.reviewerStatus = "idle"');
	});
});

// ══════════════════════════════════════════════════════════════════════
// 11.x — Reviewer constants in types.ts
// ══════════════════════════════════════════════════════════════════════

describe("11.x: Reviewer constants in types.ts", () => {
	it("11.1: REVIEWER_POLL_INTERVAL_MS is defined", () => {
		expect(typesSource).toContain("export const REVIEWER_POLL_INTERVAL_MS");
	});

	it("11.2: REVIEWER_WAIT_TIMEOUT_MS is defined (30 minutes)", () => {
		expect(typesSource).toContain("export const REVIEWER_WAIT_TIMEOUT_MS");
		expect(typesSource).toContain("30 * 60 * 1000");
	});

	it("11.3: REVIEWER_SHUTDOWN_GRACE_MS is defined", () => {
		expect(typesSource).toContain("export const REVIEWER_SHUTDOWN_GRACE_MS");
	});

	it("11.4: REVIEWER_SIGNAL_PREFIX is defined (.review-signal-)", () => {
		expect(typesSource).toContain('export const REVIEWER_SIGNAL_PREFIX = ".review-signal-"');
	});

	it("11.5: REVIEWER_SHUTDOWN_SIGNAL is defined (.review-shutdown)", () => {
		expect(typesSource).toContain('export const REVIEWER_SHUTDOWN_SIGNAL = ".review-shutdown"');
	});

	it("11.6: constants follow existing naming convention (*_MS, *_PREFIX, *_SIGNAL)", () => {
		// Verify naming matches existing patterns like MERGE_TIMEOUT_MS, EXECUTION_POLL_INTERVAL_MS
		expect(typesSource).toContain("REVIEWER_POLL_INTERVAL_MS");
		expect(typesSource).toContain("REVIEWER_WAIT_TIMEOUT_MS");
		expect(typesSource).toContain("REVIEWER_SHUTDOWN_GRACE_MS");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 12.x — Poll-for-verdict function
// ══════════════════════════════════════════════════════════════════════

describe("12.x: pollForVerdict — verdict file polling", () => {
	it("12.1: pollForVerdict function exists in review_step handler", () => {
		expect(taskRunnerSource).toContain("async function pollForVerdict()");
	});

	it("12.2: pollForVerdict checks for verdict file existence", () => {
		const fn = sourceRegion(taskRunnerSource, "function pollForVerdict", 0, 600);
		expect(fn).toContain("existsSync(outputPath)");
	});

	it("12.3: pollForVerdict detects dead persistent reviewer while waiting", () => {
		const fn = sourceRegion(taskRunnerSource, "function pollForVerdict", 0, 600);
		expect(fn).toContain("isPersistentReviewerAlive()");
		expect(fn).toContain("Persistent reviewer session died while waiting");
	});

	it("12.4: pollForVerdict has a timeout", () => {
		const fn = sourceRegion(taskRunnerSource, "function pollForVerdict", 0, 600);
		expect(fn).toContain("verdictTimeout");
		expect(fn).toContain("30 * 60 * 1000");
	});
});
