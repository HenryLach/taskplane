/**
 * Task Runner Orchestration Tests — TS-010 Step 5
 *
 * Tests for orchestrated archive suppression:
 *   5.1 — isOrchestratedMode() detection (env var combinations)
 *   5.2 — Archive suppression prompt assembly
 *
 * Run: npx tsx extensions/tests/task-runner-orchestration.test.ts
 *   or: npx vitest run extensions/tests/task-runner-orchestration.test.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isVitest = typeof globalThis.vi !== "undefined" || !!process.env.VITEST;

// ── Test Helpers ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
	if (condition) {
		passed++;
	} else {
		failed++;
		failures.push(message);
		console.error(`  ✗ ${message}`);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg);
		console.error(`  ✗ ${msg}`);
	}
}

// ── Extract function from source ─────────────────────────────────────

const sourceFile = join(__dirname, "..", "task-runner.ts");
const source = readFileSync(sourceFile, "utf8");

function extractFunction(src: string, name: string): string {
	const pattern = new RegExp(`function ${name}\\s*[<(]`);
	const match = pattern.exec(src);
	if (!match) throw new Error(`Function '${name}' not found in source`);

	let depth = 0;
	let started = false;
	let start = match.index;

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

// ── Build testable isOrchestratedMode ────────────────────────────────
// The real function reads process.env directly. We extract it and wrap
// it so we can inject env values without polluting real process.env.

const isOrchestratedModeSource = extractFunction(source, "isOrchestratedMode");

// Strip TypeScript type annotations for eval
const jsSource = isOrchestratedModeSource
	.replace(/:\s*boolean/g, "")
	.replace(/:\s*string/g, "");

// Create a factory that accepts mock env and returns the function result
function testIsOrchestratedMode(env: Record<string, string | undefined>): boolean {
	// Save original env values
	const saved: Record<string, string | undefined> = {};
	const keys = ["TASK_RUNNER_SPAWN_MODE", "TASK_RUNNER_TMUX_PREFIX"];
	for (const k of keys) {
		saved[k] = process.env[k];
	}

	try {
		// Set mock env
		for (const k of keys) {
			if (env[k] !== undefined) {
				process.env[k] = env[k];
			} else {
				delete process.env[k];
			}
		}
		// Eval the extracted function and call it
		const fn = new Function(`${jsSource}\nreturn isOrchestratedMode();`);
		return fn();
	} finally {
		// Restore original env
		for (const k of keys) {
			if (saved[k] !== undefined) {
				process.env[k] = saved[k];
			} else {
				delete process.env[k];
			}
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════
// Run all tests
// ═══════════════════════════════════════════════════════════════════════

function runAllTests(): void {
	console.log("\n══════════════════════════════════════");
	console.log("  Task Runner Orchestration Tests");
	console.log("══════════════════════════════════════\n");

	// ───────────────────────────────────────────────────────────────
	// 5.1: isOrchestratedMode — env var combination matrix
	// ───────────────────────────────────────────────────────────────
	console.log("── 5.1: isOrchestratedMode ──");

	// Both signals present → true
	assertEqual(
		testIsOrchestratedMode({
			TASK_RUNNER_SPAWN_MODE: "tmux",
			TASK_RUNNER_TMUX_PREFIX: "orch-lane-1",
		}),
		true,
		"both tmux mode + orch- prefix → true",
	);

	assertEqual(
		testIsOrchestratedMode({
			TASK_RUNNER_SPAWN_MODE: "tmux",
			TASK_RUNNER_TMUX_PREFIX: "orch-lane-3",
		}),
		true,
		"both tmux mode + orch-lane-3 prefix → true",
	);

	// Prefix present without spawn mode → still true (prefix is the sole signal)
	assertEqual(
		testIsOrchestratedMode({
			TASK_RUNNER_SPAWN_MODE: undefined,
			TASK_RUNNER_TMUX_PREFIX: "orch-lane-1",
		}),
		true,
		"orch- prefix without spawn mode → true (prefix is sufficient)",
	);

	// Prefix present with subprocess mode → true (prefix is the sole signal)
	assertEqual(
		testIsOrchestratedMode({
			TASK_RUNNER_SPAWN_MODE: "subprocess",
			TASK_RUNNER_TMUX_PREFIX: "orch-lane-1",
		}),
		true,
		"orch- prefix with subprocess mode → true (prefix is sufficient)",
	);

	// Non-orch prefix → still true (any non-empty prefix means orchestrated)
	assertEqual(
		testIsOrchestratedMode({
			TASK_RUNNER_SPAWN_MODE: "tmux",
			TASK_RUNNER_TMUX_PREFIX: "manual-session",
		}),
		true,
		"any non-empty prefix → true (orchestrated)",
	);

	// Neither signal → false
	assertEqual(
		testIsOrchestratedMode({
			TASK_RUNNER_SPAWN_MODE: undefined,
			TASK_RUNNER_TMUX_PREFIX: undefined,
		}),
		false,
		"neither signal → false",
	);

	// Spawn mode = tmux but no prefix at all → false
	assertEqual(
		testIsOrchestratedMode({
			TASK_RUNNER_SPAWN_MODE: "tmux",
			TASK_RUNNER_TMUX_PREFIX: undefined,
		}),
		false,
		"tmux mode but no prefix → false",
	);

	// Empty prefix string → false
	assertEqual(
		testIsOrchestratedMode({
			TASK_RUNNER_SPAWN_MODE: "tmux",
			TASK_RUNNER_TMUX_PREFIX: "",
		}),
		false,
		"tmux mode but empty prefix → false",
	);

	// ───────────────────────────────────────────────────────────────
	// 5.2: Archive suppression prompt assembly
	// ───────────────────────────────────────────────────────────────
	console.log("── 5.2: archiveSuppression prompt assembly ──");

	// Verify the archive suppression text exists in source and is gated
	// by isOrchestratedMode(). We extract the relevant code block.

	// Check that archiveSuppression variable exists and is conditional
	const archiveSuppressionPattern = /const\s+archiveSuppression\s*=\s*isOrchestratedMode\(\)/;
	assert(
		archiveSuppressionPattern.test(source),
		"archiveSuppression is gated by isOrchestratedMode()",
	);

	// Check the suppression message contains critical keywords
	const suppressionTextMatch = source.match(
		/archiveSuppression\s*=\s*isOrchestratedMode\(\)\s*\n\s*\?\s*"([^"]*(?:"[^"]*)*)/s,
	);
	assert(
		suppressionTextMatch !== null,
		"archiveSuppression has truthy branch (orchestrated mode text)",
	);

	// Verify the message includes key directives
	const archiveBlock = source.slice(
		source.indexOf("const archiveSuppression"),
		source.indexOf("const archiveSuppression") + 500,
	);
	assert(
		archiveBlock.includes("Do NOT archive"),
		"suppression text includes 'Do NOT archive'",
	);
	assert(
		archiveBlock.includes("Do NOT rename"),
		"suppression text includes 'Do NOT rename'",
	);
	assert(
		archiveBlock.includes(".DONE"),
		"suppression text references .DONE file",
	);
	assert(
		archiveBlock.includes("orchestrator handles"),
		"suppression text mentions orchestrator handles archival",
	);

	// Verify the falsy branch is empty string (no suppression for non-orchestrated)
	assert(
		archiveBlock.includes(': ""'),
		"non-orchestrated mode produces empty string",
	);

	// Verify archiveSuppression is used in prompt assembly
	const promptAssemblyBlock = source.slice(
		source.indexOf("const prompt = ["),
		source.indexOf("const prompt = [") + 1000,
	);
	assert(
		promptAssemblyBlock.includes("archiveSuppression"),
		"archiveSuppression is included in prompt array",
	);

	// Verify executeTask archival is gated in orchestrated mode
	const executeTaskArchiveBlock = source.slice(
		source.indexOf("// Auto-archive: move task folder to tasks/archive/"),
		source.indexOf("state.phase = \"complete\"", source.indexOf("// Auto-archive: move task folder to tasks/archive/")),
	);
	assert(
		executeTaskArchiveBlock.includes("if (!isOrchestratedMode())"),
		"executeTask archive path is gated by isOrchestratedMode()",
	);
	assert(
		executeTaskArchiveBlock.includes("skipping auto-archive"),
		"executeTask announces archive skip during orchestrated runs",
	);

	// ───────────────────────────────────────────────────────────────
	// 5.3: Integration — full prompt path verification
	// ───────────────────────────────────────────────────────────────
	console.log("── 5.3: full prompt path (orchestrated vs non-orchestrated) ──");

	// Simulate the archiveSuppression ternary with mocked env
	function buildArchiveSuppression(env: Record<string, string | undefined>): string {
		const orchestrated = testIsOrchestratedMode(env);
		return orchestrated
			? "\n\n⚠️ ORCHESTRATED RUN: Do NOT archive or move the task folder. " +
			  "Do NOT rename, relocate, or reorganize the task folder path. " +
			  "The orchestrator handles post-merge archival. " +
			  "Just create the .DONE file in the task folder when complete."
			: "";
	}

	// Orchestrated: prompt includes suppression
	const orchResult = buildArchiveSuppression({
		TASK_RUNNER_SPAWN_MODE: "tmux",
		TASK_RUNNER_TMUX_PREFIX: "orch-lane-1",
	});
	assert(orchResult.length > 0, "orchestrated mode: suppression text is non-empty");
	assert(orchResult.includes("Do NOT archive"), "orchestrated mode: contains archive directive");
	assert(orchResult.includes(".DONE"), "orchestrated mode: references .DONE");

	// Non-orchestrated: prompt is empty
	const nonOrchResult = buildArchiveSuppression({
		TASK_RUNNER_SPAWN_MODE: "subprocess",
		TASK_RUNNER_TMUX_PREFIX: undefined,
	});
	assertEqual(nonOrchResult, "", "non-orchestrated mode: suppression text is empty");

	// Prefix present with subprocess mode → still orchestrated (prefix is the sole signal)
	const prefixWithSubprocessResult = buildArchiveSuppression({
		TASK_RUNNER_SPAWN_MODE: "subprocess",
		TASK_RUNNER_TMUX_PREFIX: "orch-lane-1",
	});
	assert(prefixWithSubprocessResult.length > 0, "prefix with subprocess mode: suppression text is non-empty (prefix is sufficient)");

	// ═══════════════════════════════════════════════════════════════
	// Summary
	// ═══════════════════════════════════════════════════════════════

	console.log("\n══════════════════════════════════════");
	console.log(`  Results: ${passed} passed, ${failed} failed`);
	if (failures.length > 0) {
		console.log("\n  Failed:");
		for (const f of failures) {
			console.log(`    • ${f}`);
		}
	}
	console.log("══════════════════════════════════════\n");

	if (failed > 0) throw new Error(`${failed} test(s) failed`);
}

// ── Dual-mode execution ──────────────────────────────────────────────
if (isVitest) {
	const { describe, it } = await import("vitest");
	describe("Task Runner Orchestration", () => {
		it("passes all assertions", () => {
			runAllTests();
		});
	});
} else {
	try {
		runAllTests();
		process.exit(0);
	} catch {
		process.exit(1);
	}
}
