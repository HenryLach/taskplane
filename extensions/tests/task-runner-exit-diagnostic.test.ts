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

describe("task-runner exit diagnostic compatibility", () => {
	const src = readSource();

	it("removes tmux-only exit classification helpers", () => {
		expect(src).not.toContain("function readExitSummary(");
		expect(src).not.toContain("function buildExitDiagnostic(");
		expect(src).not.toContain("spawnAgentTmux always reports exitCode: 0");
	});

	it("retains workerExitDiagnostic field for lane-state schema compatibility", () => {
		expect(src).toContain("workerExitDiagnostic: TaskExitDiagnostic | null");
		expect(src).toContain("workerExitDiagnostic: state.workerExitDiagnostic || undefined");
	});

	it("resets stale workerExitDiagnostic before subsequent iterations", () => {
		expect(src).toContain("state.workerExitDiagnostic = null;");
	});
});
