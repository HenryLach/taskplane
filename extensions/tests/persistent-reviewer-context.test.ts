import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_RUNNER_PATH = resolve(__dirname, "../task-runner.ts");

function readSource(): string {
	return readFileSync(TASK_RUNNER_PATH, "utf-8");
}

function extractRegion(src: string, marker: string): string {
	const start = src.indexOf(marker);
	if (start < 0) throw new Error(`marker not found: ${marker}`);
	const rest = src.slice(start + 1);
	const nextSection = rest.search(/\n\t\/\/ ── /);
	return nextSection < 0 ? src.slice(start) : src.slice(start, start + 1 + nextSection);
}

describe("review_step subprocess reviewer flow", () => {
	const src = readSource();
	const reviewBlock = extractRegion(src, "\t// ── review_step Tool (orchestrated mode only) ───────────────────");

	it("uses subprocess reviewer spawn and does not use wait_for_review signals", () => {
		expect(reviewBlock).toContain("reviewer-subprocess");
		expect(reviewBlock).toContain("const spawned = spawnAgent({");
		expect(reviewBlock).not.toContain("wait_for_review");
		expect(reviewBlock).not.toContain("REVIEWER_SIGNAL_PREFIX");
		expect(reviewBlock).not.toContain("spawnSync(\"tmux\"");
	});

	it("retains low-risk and code-cycle safeguards", () => {
		expect(reviewBlock).toContain("isLowRiskStep(stepNum, task.steps.length)");
		expect(reviewBlock).toContain("Step ${stepNum} code review cycle limit reached");
	});

	it("shutdown helper is now a compatibility no-op", () => {
		expect(src).toContain("No persistent reviewer active");
		expect(src).not.toContain("cleanStaleReviewerSignals(");
	});
});
