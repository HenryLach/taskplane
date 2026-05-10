import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import * as fs from "fs";
import { tmpdir } from "os";
import vm from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));

function extractFunction(source: string, signature: string, nextMarker: string): string {
	const start = source.indexOf(signature);
	if (start < 0) throw new Error(`Missing signature: ${signature}`);
	const end = source.indexOf(nextMarker, start);
	if (end < 0) throw new Error(`Missing marker: ${nextMarker}`);
	return source.slice(start, end).trim();
}

describe("dashboard loadHistory", () => {
	it("returns entries in file order so newest batch stays first", () => {
		const source = readFileSync(
			join(__dirname, "..", "..", "dashboard", "server.cjs"),
			"utf-8",
		).replace(/\r\n/g, "\n");

		const fnSource = extractFunction(source, "function loadHistory()", "/** GET /api/history");

		const root = mkdtempSync(join(tmpdir(), "tp-137-dashboard-"));
		const historyPath = join(root, ".pi", "batch-history.json");
		mkdirSync(join(root, ".pi"), { recursive: true });
		writeFileSync(
			historyPath,
			JSON.stringify(
				[
					{ batchId: "batch-new", startedAt: 2000 },
					{ batchId: "batch-old", startedAt: 1000 },
				],
				null,
				2,
			),
		);

		try {
			const context = {
				fs,
				BATCH_HISTORY_PATH: historyPath,
			};
			const loadHistory = vm.runInNewContext(`${fnSource}; loadHistory;`, context) as () => Array<{
				batchId: string;
			}>;
			const history = loadHistory();
			expect(history).toHaveLength(2);
			expect(history[0].batchId).toBe("batch-new");
			expect(history[1].batchId).toBe("batch-old");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
