import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_SCRIPT_PATH = join(__dirname, "..", "..", "scripts", "tmux-reference-audit.mjs");

interface AuditOutput {
	schemaVersion: number;
	scope: { roots: string[]; extensions: string[] };
	contracts: {
		categoryOrder: string[];
		strictMode: {
			failureExitCode: number;
		};
	};
	totals: {
		references: number;
		filesScanned: number;
		filesWithReferences: number;
	};
	byCategory: Record<string, number>;
	byFile: Array<{
		file: string;
		references: number;
		byCategory: Record<string, number>;
	}>;
	functionalUsage: {
		count: number;
		matches: Array<{
			file: string;
			line: number;
			column: number;
			pattern: string;
			snippet: string;
		}>;
	};
}

function runAuditRaw(extraArgs: string[] = []): string {
	return execFileSync(process.execPath, [AUDIT_SCRIPT_PATH, "--json", ...extraArgs], {
		encoding: "utf-8",
	});
}

function runAudit(extraArgs: string[] = []): AuditOutput {
	const raw = runAuditRaw(extraArgs);
	return JSON.parse(raw) as AuditOutput;
}

describe("TMUX reference guard", () => {
	it("reports parseable JSON with deterministic ordering contract", () => {
		const first = runAuditRaw();
		const second = runAuditRaw();
		expect(second).toBe(first);

		const parsed = JSON.parse(first) as AuditOutput;
		expect(parsed.schemaVersion).toBe(2);
		expect(parsed.scope.roots).toEqual(["extensions", "bin", "templates", "dashboard", "skills"]);
		expect(parsed.scope.extensions).toContain(".cjs");
		expect(parsed.scope.extensions).toContain(".mjs");
		expect(parsed.scope.extensions).toContain(".ts");
		expect(parsed.totals.filesScanned).toBeGreaterThan(0);
		expect(parsed.totals.references).toBeGreaterThan(0);
		expect(parsed.totals.filesWithReferences).toBeGreaterThan(0);

		expect(Object.keys(parsed.byCategory)).toEqual([
			"compat-code",
			"user-facing strings",
			"comments/docs",
			"types/contracts",
		]);

		const files = parsed.byFile.map(entry => entry.file);
		const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));
		expect(files).toEqual(sortedFiles);
		for (const file of files) {
			expect(file.includes("\\")).toBe(false);
		}

		const byCategoryTotal = Object.values(parsed.byCategory).reduce((sum, n) => sum + n, 0);
		expect(byCategoryTotal).toBe(parsed.totals.references);

		const byFileTotal = parsed.byFile.reduce((sum, file) => sum + file.references, 0);
		expect(byFileTotal).toBe(parsed.totals.references);
	});

	it("finds no functional TMUX command execution in scanned package roots", () => {
		const parsed = runAudit(["--strict"]);
		expect(parsed.functionalUsage.count).toBe(0);
		expect(parsed.functionalUsage.matches).toHaveLength(0);
		expect(parsed.contracts.strictMode.failureExitCode).toBe(2);
	});
});
