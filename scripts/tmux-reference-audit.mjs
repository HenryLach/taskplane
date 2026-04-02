#!/usr/bin/env node

/**
 * tmux-reference-audit.mjs
 *
 * Deterministic static audit for TMUX references in `extensions/taskplane/*.ts`.
 *
 * Contract:
 * - Emits stable JSON schema with totals + by-file + by-category counts.
 * - `--strict` fails (exit code 2) ONLY on functional TMUX command execution
 *   patterns (spawn/exec families in executable code).
 * - Excludes comments/docs, user-facing text, and compatibility metadata from
 *   strict failures.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CATEGORY_ORDER = [
	"compat-code",
	"user-facing strings",
	"comments/docs",
	"types/contracts",
];

const STRICT_FAILURE_EXIT_CODE = 2;
const SCAN_ROOT = "extensions/taskplane";
const FILE_GLOB = "*.ts";

const USER_FACING_FILES = new Set([
	"messages.ts",
	"formatting.ts",
	"settings-tui.ts",
	"supervisor.ts",
]);

const TYPES_CONTRACT_FILES = new Set([
	"types.ts",
	"config-schema.ts",
]);

const FUNCTIONAL_PATTERNS = [
	{
		id: "spawn-executable",
		regex: /\b(?:spawn|spawnSync|execFile|execFileSync|execa|execaSync)\s*\(\s*["'`]tmux["'`]/i,
	},
	{
		id: "exec-shell-command",
		regex: /\b(?:exec|execSync)\s*\(\s*["'`][^"'`]*\btmux\b[^"'`]*["'`]/i,
	},
	{
		id: "spawn-shell-payload",
		regex: /\b(?:spawn|spawnSync)\s*\([^\n]*["'`][^"'`]*\btmux\b[^"'`]*["'`]/i,
	},
];

function hasFlag(flag) {
	return process.argv.slice(2).includes(flag);
}

function printUsage() {
	console.log(`Usage: node scripts/tmux-reference-audit.mjs [--json] [--strict] [--help]

Options:
  --json    Explicitly request JSON output (default behavior)
  --strict  Exit ${STRICT_FAILURE_EXIT_CODE} when functional TMUX command execution is detected
  --help    Show this help text`);
}

function createCategoryCounter() {
	return {
		"compat-code": 0,
		"user-facing strings": 0,
		"comments/docs": 0,
		"types/contracts": 0,
	};
}

function isCommentLine(trimmed, inBlockComment) {
	if (inBlockComment) return true;
	if (trimmed.startsWith("//")) return true;
	if (trimmed.startsWith("/*")) return true;
	if (trimmed.startsWith("*")) return true;
	return false;
}

function detectFunctionalUsage(line) {
	for (const pattern of FUNCTIONAL_PATTERNS) {
		if (pattern.regex.test(line)) return pattern.id;
	}
	return null;
}

function isUserFacingLine(fileName, line) {
	if (USER_FACING_FILES.has(fileName)) return true;

	if (fileName === "extension.ts") {
		return line.includes("ctx.ui.notify") || line.includes("TMUX") || line.includes("tmux");
	}

	if (fileName === "worktree.ts") {
		const hasDisplayContext = line.includes("message:") || line.includes("hint:") || /["'`]/.test(line);
		return hasDisplayContext && /tmux/i.test(line);
	}

	if (fileName === "sessions.ts") {
		return line.includes("attachCmd") && /tmux/i.test(line);
	}

	const looksLikeStringLiteral = /["'`]/.test(line);
	if (!looksLikeStringLiteral) return false;

	return /\b(?:notify|message|hint|attachCmd|sessionsNone|description|label)\b/.test(line);
}

function classifyLine(fileName, line, commentLine) {
	if (TYPES_CONTRACT_FILES.has(fileName)) return "types/contracts";
	if (commentLine) return "comments/docs";
	if (isUserFacingLine(fileName, line)) return "user-facing strings";
	return "compat-code";
}

function normalizeRepoPath(pathValue) {
	return pathValue.split("\\").join("/");
}

function buildAudit() {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const repoRoot = resolve(scriptDir, "..");
	const scanDir = join(repoRoot, SCAN_ROOT);

	const entries = readdirSync(scanDir, { withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith(".ts"))
		.map(entry => entry.name)
		.sort((a, b) => a.localeCompare(b));

	const totalsByCategory = createCategoryCounter();
	const byFile = [];
	const functionalMatches = [];
	let totalReferences = 0;

	for (const fileName of entries) {
		const absPath = join(scanDir, fileName);
		const relPath = normalizeRepoPath(relative(repoRoot, absPath));
		const source = readFileSync(absPath, "utf-8");
		const lines = source.split(/\r?\n/);
		const fileByCategory = createCategoryCounter();
		let fileRefs = 0;
		let inBlockComment = false;

		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];
			const trimmed = line.trim();
			const matches = line.match(/tmux/gi);
			const matchCount = matches ? matches.length : 0;

			const commentLine = isCommentLine(trimmed, inBlockComment);
			const category = matchCount > 0 ? classifyLine(fileName, line, commentLine) : null;

			if (matchCount > 0) {
				fileRefs += matchCount;
				totalReferences += matchCount;
				fileByCategory[category] += matchCount;
				totalsByCategory[category] += matchCount;

				if (!commentLine) {
					const patternId = detectFunctionalUsage(line);
					if (patternId) {
						const firstIndex = line.toLowerCase().indexOf("tmux");
						functionalMatches.push({
							file: relPath,
							line: index + 1,
							column: firstIndex >= 0 ? firstIndex + 1 : 1,
							pattern: patternId,
							snippet: trimmed,
						});
					}
				}
			}

			if (trimmed.includes("/*") && !trimmed.includes("*/")) {
				inBlockComment = true;
			}
			if (inBlockComment && trimmed.includes("*/")) {
				inBlockComment = false;
			}
		}

		byFile.push({
			file: relPath,
			references: fileRefs,
			byCategory: fileByCategory,
		});
	}

	functionalMatches.sort((a, b) => {
		if (a.file !== b.file) return a.file.localeCompare(b.file);
		if (a.line !== b.line) return a.line - b.line;
		if (a.column !== b.column) return a.column - b.column;
		return a.pattern.localeCompare(b.pattern);
	});

	const filesWithReferences = byFile.filter(entry => entry.references > 0).length;

	return {
		schemaVersion: 1,
		scope: {
			root: SCAN_ROOT,
			glob: FILE_GLOB,
		},
		contracts: {
			categoryOrder: CATEGORY_ORDER,
			strictMode: {
				includes: [
					"process execution patterns (`spawn*`, `exec*`, `execFile*`, `execa*`) where tmux appears as executable or executed shell payload",
				],
				excludes: [
					"comments/docs",
					"user-facing strings (e.g. attach hints)",
					"compatibility metadata and type contracts",
				],
				failureExitCode: STRICT_FAILURE_EXIT_CODE,
			},
		},
		totals: {
			references: totalReferences,
			filesScanned: byFile.length,
			filesWithReferences,
		},
		byCategory: {
			"compat-code": totalsByCategory["compat-code"],
			"user-facing strings": totalsByCategory["user-facing strings"],
			"comments/docs": totalsByCategory["comments/docs"],
			"types/contracts": totalsByCategory["types/contracts"],
		},
		byFile,
		functionalUsage: {
			count: functionalMatches.length,
			matches: functionalMatches,
		},
	};
}

function main() {
	const args = process.argv.slice(2);
	if (args.includes("--help")) {
		printUsage();
		return;
	}

	const known = new Set(["--json", "--strict", "--help"]);
	const unknown = args.filter(arg => !known.has(arg));
	if (unknown.length > 0) {
		console.error(`[tmux-reference-audit] Unknown option(s): ${unknown.join(", ")}`);
		printUsage();
		process.exit(64);
	}

	const strictMode = hasFlag("--strict");
	const output = buildAudit();

	process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);

	if (strictMode && output.functionalUsage.count > 0) {
		console.error(
			`[tmux-reference-audit] strict mode failed: ${output.functionalUsage.count} functional TMUX command usage match(es) detected.`,
		);
		process.exit(STRICT_FAILURE_EXIT_CODE);
	}
}

main();
