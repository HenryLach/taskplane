#!/usr/bin/env node

/**
 * tmux-reference-audit.mjs
 *
 * Deterministic static audit for TMUX references across shipped package roots.
 *
 * Contract:
 * - Emits stable JSON schema with totals + by-file + by-category counts.
 * - `--strict` fails (exit code 2) ONLY on functional TMUX command execution
 *   patterns (spawn/exec families in executable code).
 * - Excludes comments/docs, user-facing text, and compatibility metadata from
 *   strict failures.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CATEGORY_ORDER = [
	"compat-code",
	"user-facing strings",
	"comments/docs",
	"types/contracts",
];

const STRICT_FAILURE_EXIT_CODE = 2;
const SCAN_ROOTS = ["extensions", "bin", "templates", "dashboard"];
const SCAN_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".mjs",
	".cjs",
	".md",
	".json",
	".yaml",
	".yml",
	".html",
	".css",
]);
const EXECUTABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

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
		regex: /\b(?:spawn|spawnSync)\s*\(\s*["'`][^"'`]*\btmux\b\s+[^"'`]*["'`]/i,
	},
	{
		id: "execfile-shell-payload",
		regex: /\b(?:execFile|execFileSync)\s*\(\s*["'`][^"'`]*\btmux\b\s+[^"'`]*["'`]/i,
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

function classifyLine(fileName, fileExt, line, commentLine) {
	if (!EXECUTABLE_EXTENSIONS.has(fileExt)) return "comments/docs";
	if (TYPES_CONTRACT_FILES.has(fileName)) return "types/contracts";
	if (commentLine) return "comments/docs";
	if (isUserFacingLine(fileName, line)) return "user-facing strings";
	return "compat-code";
}

function normalizeRepoPath(pathValue) {
	return pathValue.split("\\").join("/");
}

function collectFilesRecursive(repoRoot, rootRel, out) {
	const absRoot = join(repoRoot, rootRel);
	if (!existsSync(absRoot)) return;

	const stack = [absRoot];
	while (stack.length > 0) {
		const current = stack.pop();
		const entries = readdirSync(current, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name));

		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			const absPath = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(absPath);
				continue;
			}
			if (!entry.isFile()) continue;
			const extension = extname(entry.name).toLowerCase();
			if (!SCAN_EXTENSIONS.has(extension)) continue;
			out.push(absPath);
		}
	}
}

function buildAudit() {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const repoRoot = resolve(scriptDir, "..");
	const entriesAbs = [];

	for (const scanRoot of SCAN_ROOTS) {
		collectFilesRecursive(repoRoot, scanRoot, entriesAbs);
	}

	entriesAbs.sort((a, b) => normalizeRepoPath(relative(repoRoot, a)).localeCompare(normalizeRepoPath(relative(repoRoot, b))));

	const totalsByCategory = createCategoryCounter();
	const byFile = [];
	const functionalMatches = [];
	let totalReferences = 0;

	for (const absPath of entriesAbs) {
		const relPath = normalizeRepoPath(relative(repoRoot, absPath));
		const fileName = relPath.split("/").at(-1) || relPath;
		const fileExt = extname(fileName).toLowerCase();
		const source = readFileSync(absPath, "utf-8");
		const lines = source.split(/\r?\n/);
		const fileByCategory = createCategoryCounter();
		let fileRefs = 0;
		let inBlockComment = false;
		const executableFile = EXECUTABLE_EXTENSIONS.has(fileExt);

		for (let index = 0; index < lines.length; index++) {
			const line = lines[index];
			const trimmed = line.trim();
			const matches = line.match(/tmux/gi);
			const matchCount = matches ? matches.length : 0;

			const commentLine = executableFile ? isCommentLine(trimmed, inBlockComment) : true;
			const category = matchCount > 0 ? classifyLine(fileName, fileExt, line, commentLine) : null;

			if (matchCount > 0) {
				fileRefs += matchCount;
				totalReferences += matchCount;
				fileByCategory[category] += matchCount;
				totalsByCategory[category] += matchCount;

				if (executableFile && !commentLine) {
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

			if (executableFile && trimmed.includes("/*") && !trimmed.includes("*/")) {
				inBlockComment = true;
			}
			if (executableFile && inBlockComment && trimmed.includes("*/")) {
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
		schemaVersion: 2,
		scope: {
			roots: [...SCAN_ROOTS],
			extensions: [...SCAN_EXTENSIONS].sort((a, b) => a.localeCompare(b)),
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
