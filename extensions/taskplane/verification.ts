/**
 * Verification baseline fingerprinting system.
 *
 * Captures test output before and after merge, parses it into normalized
 * fingerprints, and diffs to identify genuinely new failures vs pre-existing ones.
 *
 * Design notes:
 *
 * **Runner result schema:** Each command produces a CommandResult with:
 *   - commandId: string key from testing.commands config
 *   - exitCode: number (process exit code, -1 for spawn errors)
 *   - stdout: string (captured raw stdout)
 *   - stderr: string (captured raw stderr)
 *   - durationMs: number
 *   - error: string | null (spawn/timeout error message)
 *
 * **Fingerprint equality key:** Composite of all five fields joined by \0:
 *   `${commandId}\0${file}\0${case}\0${kind}\0${messageNorm}`
 *   Duplicates within a single run are collapsed before diffing.
 *
 * **messageNorm normalization rules:**
 *   1. Strip ANSI escape sequences
 *   2. Normalize path separators (backslash → forward slash)
 *   3. Remove duration strings (e.g., "(42ms)", "(1.2s)")
 *   4. Remove ISO-8601 timestamps
 *   5. Collapse whitespace (runs of space/tab/newline → single space, then trim)
 *   6. Truncate to 512 chars (bound fingerprint size)
 *
 * **Fallback for non-JSON output:**
 *   If vitest JSON parsing fails (truncated, missing, non-JSON), produce a
 *   single fingerprint with kind: "command_error" and the first 512 chars
 *   of stderr (or stdout) as messageNorm.
 *
 * @module orch/verification
 */
import { spawnSync } from "child_process";

// ── Types ────────────────────────────────────────────────────────────

/**
 * A configured verification command from testing.commands config.
 */
export interface VerificationCommand {
	/** Stable key from config (e.g., "test", "build") — used as commandId */
	id: string;
	/** Shell command string to execute */
	command: string;
}

/**
 * Result of running a single verification command.
 */
export interface CommandResult {
	/** Key from testing.commands config (e.g., "test", "build") */
	commandId: string;
	/** Process exit code. -1 for spawn/timeout errors. */
	exitCode: number;
	/** Captured stdout */
	stdout: string;
	/** Captured stderr */
	stderr: string;
	/** Wall-clock duration in milliseconds */
	durationMs: number;
	/** Error message if command failed to spawn or timed out; null otherwise */
	error: string | null;
}

/**
 * Normalized test fingerprint identifying a single test outcome.
 *
 * Equality is determined by ALL five fields — the composite key.
 */
export interface TestFingerprint {
	/** Command that produced this result (key from testing.commands) */
	commandId: string;
	/** Source file path (normalized to forward slashes) */
	file: string;
	/** Test case full name (describe > it chain) */
	case: string;
	/** Failure classification */
	kind: "assertion_error" | "runtime_error" | "timeout" | "command_error" | "unknown";
	/** Normalized failure message (see normalization rules in module doc) */
	messageNorm: string;
}

/**
 * A captured verification baseline or post-merge snapshot.
 */
export interface VerificationBaseline {
	/** When this baseline was captured (ISO 8601) */
	capturedAt: string;
	/** Command results (one per configured command) */
	commandResults: CommandResult[];
	/** Deduplicated fingerprints extracted from all command results */
	fingerprints: TestFingerprint[];
}

/**
 * Result of diffing two fingerprint sets.
 */
export interface FingerprintDiff {
	/** Failures present in postMerge but not in baseline */
	newFailures: TestFingerprint[];
	/** Failures present in both baseline and postMerge (pre-existing) */
	preExisting: TestFingerprint[];
	/** Failures in baseline that disappeared in postMerge (fixed) */
	fixed: TestFingerprint[];
}


// ── Normalization Helpers ────────────────────────────────────────────

/** Max length for normalized message strings */
const MESSAGE_NORM_MAX_LENGTH = 512;

// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /[\u001b\u009b]\[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

/** Match duration strings like (42ms), (1.2s), (3m 12s), 42 ms, 1200ms */
const DURATION_REGEX = /\(?\d+(?:\.\d+)?\s*(?:ms|s|m)\s*(?:\d+(?:\.\d+)?\s*(?:ms|s))?\)?/g;

/** Match ISO-8601 timestamps like 2026-03-20T12:34:56.789Z */
const TIMESTAMP_REGEX = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g;

/**
 * Normalize a failure message for stable fingerprinting.
 *
 * 1. Strip ANSI escape sequences
 * 2. Normalize path separators (\ → /)
 * 3. Remove duration strings (e.g., "(42ms)", "(1.2s)")
 * 4. Remove ISO-8601 timestamps
 * 5. Collapse whitespace
 * 6. Truncate to MESSAGE_NORM_MAX_LENGTH
 */
export function normalizeMessage(raw: string): string {
	let msg = raw;
	// 1. Strip ANSI
	msg = msg.replace(ANSI_REGEX, "");
	// 2. Normalize path separators
	msg = msg.replace(/\\/g, "/");
	// 3. Remove duration strings
	msg = msg.replace(DURATION_REGEX, "");
	// 4. Remove ISO-8601 timestamps
	msg = msg.replace(TIMESTAMP_REGEX, "");
	// 5. Collapse whitespace
	msg = msg.replace(/\s+/g, " ").trim();
	// 6. Truncate
	if (msg.length > MESSAGE_NORM_MAX_LENGTH) {
		msg = msg.slice(0, MESSAGE_NORM_MAX_LENGTH);
	}
	return msg;
}

/**
 * Normalize a file path for stable fingerprinting.
 * Converts backslashes to forward slashes.
 */
export function normalizeFilePath(raw: string): string {
	return raw.replace(/\\/g, "/");
}

/**
 * Compute a stable string key for a fingerprint used in set operations.
 * Fields joined by null byte (unlikely in test output).
 */
export function fingerprintKey(fp: TestFingerprint): string {
	return `${fp.commandId}\0${fp.file}\0${fp.case}\0${fp.kind}\0${fp.messageNorm}`;
}


// ── Command Runner ───────────────────────────────────────────────────

/** Default timeout for verification commands: 5 minutes */
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run configured verification commands and return per-command results.
 *
 * Commands are iterated in deterministic insertion order of the
 * `testing.commands` config map. Each command runs synchronously in
 * the specified working directory (typically the merge worktree).
 *
 * @param commands  - Map of commandId → shell command string (from testing.commands config)
 * @param cwd       - Working directory to run commands in
 * @param timeoutMs - Per-command timeout in milliseconds (default: 5 min)
 * @returns Array of CommandResult in config iteration order
 */
export function runVerificationCommands(
	commands: Record<string, string>,
	cwd: string,
	timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS,
): CommandResult[] {
	const results: CommandResult[] = [];

	for (const [commandId, command] of Object.entries(commands)) {
		const start = Date.now();
		try {
			const isWindows = process.platform === "win32";
			const shell = isWindows ? "cmd" : "/bin/sh";
			const shellArgs = isWindows ? ["/c", command] : ["-c", command];

			const proc = spawnSync(shell, shellArgs, {
				cwd,
				encoding: "utf-8",
				timeout: timeoutMs,
				stdio: ["pipe", "pipe", "pipe"],
				// Ensure child processes don't inherit stdin
				env: { ...process.env },
			});

			const durationMs = Date.now() - start;

			if (proc.error) {
				// Spawn error or timeout
				const isTimeout = (proc.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
				results.push({
					commandId,
					exitCode: -1,
					stdout: proc.stdout || "",
					stderr: proc.stderr || "",
					durationMs,
					error: isTimeout
						? `Command timed out after ${timeoutMs}ms`
						: `Spawn error: ${proc.error.message}`,
				});
			} else {
				results.push({
					commandId,
					exitCode: proc.status ?? -1,
					stdout: proc.stdout || "",
					stderr: proc.stderr || "",
					durationMs,
					error: null,
				});
			}
		} catch (err: unknown) {
			const durationMs = Date.now() - start;
			const message = err instanceof Error ? err.message : String(err);
			results.push({
				commandId,
				exitCode: -1,
				stdout: "",
				stderr: "",
				durationMs,
				error: `Unexpected error: ${message}`,
			});
		}
	}

	return results;
}


// ── Test Output Parsers ──────────────────────────────────────────────

/**
 * Vitest JSON reporter output shape (subset of fields we care about).
 */
interface VitestJsonResult {
	testResults?: Array<{
		name?: string;
		status?: string;
		message?: string;
		assertionResults?: Array<{
			fullName?: string;
			status?: string;
			failureMessages?: string[];
		}>;
	}>;
}

/**
 * Classify a failure message into a kind.
 */
function classifyFailureKind(message: string): TestFingerprint["kind"] {
	const lower = message.toLowerCase();
	if (lower.includes("timeout") || lower.includes("timed out")) {
		return "timeout";
	}
	if (
		lower.includes("assert") ||
		lower.includes("expect") ||
		lower.includes("tobe") ||
		lower.includes("toequal") ||
		lower.includes("tohave")
	) {
		return "assertion_error";
	}
	if (
		lower.includes("referenceerror") ||
		lower.includes("typeerror") ||
		lower.includes("syntaxerror") ||
		lower.includes("cannot find module") ||
		lower.includes("is not defined") ||
		lower.includes("is not a function")
	) {
		return "runtime_error";
	}
	return "unknown";
}

/**
 * Parse vitest JSON reporter output into test fingerprints.
 *
 * Expects the stdout to contain a JSON object matching vitest's JSON reporter format.
 * Only failed tests produce fingerprints (passed tests are irrelevant for baseline diffing).
 *
 * If JSON parsing fails or the structure is unexpected, returns null to signal
 * that the caller should use fallback fingerprinting.
 *
 * @param commandId - The command that produced this output
 * @param stdout    - Raw stdout from the vitest command
 * @returns Array of fingerprints for failed tests, or null if parsing fails
 */
export function parseVitestOutput(commandId: string, stdout: string): TestFingerprint[] | null {
	// Try to extract JSON from stdout (vitest may prepend/append non-JSON lines)
	let json: VitestJsonResult;
	try {
		// First attempt: parse the whole stdout as JSON
		json = JSON.parse(stdout);
	} catch {
		// Second attempt: find the first { and last } to extract JSON block
		const firstBrace = stdout.indexOf("{");
		const lastBrace = stdout.lastIndexOf("}");
		if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
			return null;
		}
		try {
			json = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
		} catch {
			return null;
		}
	}

	if (!json || !Array.isArray(json.testResults)) {
		return null;
	}

	const fingerprints: TestFingerprint[] = [];

	for (const testFile of json.testResults) {
		const file = normalizeFilePath(testFile.name || "unknown");
		const assertions = testFile.assertionResults;
		const hasAssertions = Array.isArray(assertions) && assertions.length > 0;

		if (hasAssertions) {
			for (const assertion of assertions!) {
				// Only fingerprint failures
				if (assertion.status !== "failed") continue;

				const caseName = assertion.fullName || "unknown";
				const messages = assertion.failureMessages || [];
				const rawMessage = messages.join("\n") || "no failure message";

				fingerprints.push({
					commandId,
					file,
					case: caseName,
					kind: classifyFailureKind(rawMessage),
					messageNorm: normalizeMessage(rawMessage),
				});
			}
		}

		// Suite-level failures: testResults[].status === "failed" with no assertion-level details.
		// This covers setup/import/runtime-at-file-load errors where vitest marks the file as
		// failed but produces no assertionResults (or only non-failed ones).
		if (testFile.status === "failed") {
			const hasFailedAssertions = hasAssertions && assertions!.some(a => a.status === "failed");
			if (!hasFailedAssertions) {
				// No assertion-level failures captured — emit suite-level runtime_error fingerprint
				const suiteMessage = testFile.message || "Suite failed with no message";
				fingerprints.push({
					commandId,
					file,
					case: "<suite>",
					kind: "runtime_error",
					messageNorm: normalizeMessage(suiteMessage),
				});
			}
		}
	}

	return fingerprints;
}

/**
 * Parse test output into normalized fingerprints.
 *
 * Strategy:
 * 1. Try vitest JSON adapter
 * 2. If parsing fails: produce a fallback command_error fingerprint
 *
 * The adapter pattern is extensible — future parsers for jest, pytest, etc.
 * can be added here as additional try paths before the fallback.
 *
 * @param commandResult - Result from runVerificationCommands
 * @returns Array of fingerprints (always non-empty for failed commands)
 */
export function parseTestOutput(commandResult: CommandResult): TestFingerprint[] {
	const { commandId, exitCode, stdout, stderr, error } = commandResult;

	// If command had a spawn/timeout error, produce a command_error fingerprint
	if (error) {
		return [{
			commandId,
			file: "",
			case: "",
			kind: "command_error",
			messageNorm: normalizeMessage(error),
		}];
	}

	// If exit code is 0, no failures to fingerprint
	if (exitCode === 0) {
		return [];
	}

	// Try vitest JSON adapter
	const vitestFingerprints = parseVitestOutput(commandId, stdout);
	if (vitestFingerprints !== null && vitestFingerprints.length > 0) {
		return vitestFingerprints;
	}

	// Vitest JSON parsed successfully but produced zero fingerprints with non-zero exit.
	// This can happen if the JSON structure is valid but contains no failure details
	// we could extract. Fall through to the generic fallback below.

	// Fallback: command_error fingerprint with stderr (or stdout if stderr is empty)
	const fallbackMessage = stderr.trim() || stdout.trim() || "Command failed with no output";
	return [{
		commandId,
		file: "",
		case: "",
		kind: "command_error",
		messageNorm: normalizeMessage(fallbackMessage),
	}];
}


// ── Fingerprint Diffing ──────────────────────────────────────────────

/**
 * Deduplicate fingerprints by their composite key.
 * Preserves the first occurrence of each unique fingerprint.
 */
export function deduplicateFingerprints(fingerprints: TestFingerprint[]): TestFingerprint[] {
	const seen = new Set<string>();
	const result: TestFingerprint[] = [];

	for (const fp of fingerprints) {
		const key = fingerprintKey(fp);
		if (!seen.has(key)) {
			seen.add(key);
			result.push(fp);
		}
	}

	return result;
}

/**
 * Diff two fingerprint sets to identify new failures, pre-existing failures, and fixes.
 *
 * Uses set-based comparison on the composite fingerprint key.
 * Both sets are deduplicated before comparison.
 *
 * @param baseline  - Fingerprints from pre-merge verification run
 * @param postMerge - Fingerprints from post-merge verification run
 * @returns FingerprintDiff with new failures, pre-existing, and fixed sets
 */
export function diffFingerprints(
	baseline: TestFingerprint[],
	postMerge: TestFingerprint[],
): FingerprintDiff {
	const dedupBaseline = deduplicateFingerprints(baseline);
	const dedupPostMerge = deduplicateFingerprints(postMerge);

	const baselineKeys = new Set(dedupBaseline.map(fingerprintKey));
	const postMergeKeys = new Set(dedupPostMerge.map(fingerprintKey));

	const newFailures: TestFingerprint[] = [];
	const preExisting: TestFingerprint[] = [];
	const fixed: TestFingerprint[] = [];

	// Classify post-merge fingerprints
	for (const fp of dedupPostMerge) {
		const key = fingerprintKey(fp);
		if (baselineKeys.has(key)) {
			preExisting.push(fp);
		} else {
			newFailures.push(fp);
		}
	}

	// Find fixed: in baseline but not in post-merge
	for (const fp of dedupBaseline) {
		const key = fingerprintKey(fp);
		if (!postMergeKeys.has(key)) {
			fixed.push(fp);
		}
	}

	return { newFailures, preExisting, fixed };
}


// ── Baseline Capture ─────────────────────────────────────────────────

/**
 * Run verification commands and capture a complete baseline snapshot.
 *
 * @param commands  - Map of commandId → shell command string
 * @param cwd       - Working directory (merge worktree)
 * @param timeoutMs - Per-command timeout
 * @returns VerificationBaseline with command results and extracted fingerprints
 */
export function captureBaseline(
	commands: Record<string, string>,
	cwd: string,
	timeoutMs?: number,
): VerificationBaseline {
	const commandResults = runVerificationCommands(commands, cwd, timeoutMs);

	// Extract fingerprints from all command results
	const allFingerprints: TestFingerprint[] = [];
	for (const result of commandResults) {
		const fps = parseTestOutput(result);
		allFingerprints.push(...fps);
	}

	return {
		capturedAt: new Date().toISOString(),
		commandResults,
		fingerprints: deduplicateFingerprints(allFingerprints),
	};
}
