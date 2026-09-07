/**
 * #630 — residual wiring after the Tier-1 hold bridge was replaced by the
 * first-class `held` state (#627, see held-state-runner.test.ts for the
 * behavioural suite):
 *   - build marker in engine identity (hot-fix audit)
 *   - send_agent_message to a dead-pid agent returns an actionable error
 *   - configurable exit-intercept window (feedback #3 item 5)
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
function readSrc(file: string): string {
	return readFileSync(join(HERE, "..", "taskplane", file), "utf-8");
}

describe("#630 — build marker", () => {
	let tmpRoot: string;
	beforeEach(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), "tp630-"));
	});
	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("engine identity carries taskplaneVersion + taskplaneBuild", async () => {
		const { taskplaneBuildMarker, writeEngineIdentity, readEngineIdentity } = await import(
			"../taskplane/engine-identity.ts"
		);
		const m = taskplaneBuildMarker();
		expect(/^\d+\.\d+\.\d+/.test(m.taskplaneVersion)).toBe(true);
		expect(/^[0-9a-f]{12}$/.test(m.taskplaneBuild)).toBe(true);
		const root = join(tmpRoot, "bm");
		mkdirSync(root, { recursive: true });
		writeEngineIdentity(root, { batchId: "b", pid: process.pid, supervisorPid: 1, startedAt: 1 });
		const id = readEngineIdentity(root, "b")!;
		expect(id.taskplaneBuild).toBe(m.taskplaneBuild);
		expect(id.taskplaneVersion).toBe(m.taskplaneVersion);
	});
});

describe("#630 — wiring", () => {
	it("send_agent_message to a dead-pid agent returns a distinct, actionable error (pid, last-seen, resume hint)", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		expect(/is DEAD: its process \(PID \$\{manifest\.pid\}\) no longer exists/.test(flat)).toBe(true);
		expect(flat).toContain(
			"Do NOT hand-edit registry.json. orch_resume(force=true) reconciles the dead worker",
		);
		// It runs BEFORE the generic unknown-session validation.
		const src = readSrc("extension.ts");
		const dead = src.indexOf("is DEAD: its process");
		const unknown = src.indexOf("Build valid runtime agent IDs (registry-first, legacy fallback).");
		expect(dead).toBeGreaterThan(-1);
		expect(unknown).toBeGreaterThan(dead);
	});
});

describe("#630 — configurable exit-intercept window (feedback #3 item 5)", () => {
	it("taskRunner.worker.exitInterceptTimeoutSec threads config → env → lane-runner → agent-host safety race", async () => {
		const { buildWorkerEnv } = await import("../taskplane/execution.ts");
		expect(
			buildWorkerEnv({ exitInterceptTimeoutSec: 300 }).TASKPLANE_EXIT_INTERCEPT_TIMEOUT_SEC,
		).toBe("300");
		expect(buildWorkerEnv({ exitInterceptTimeoutSec: 5 }).TASKPLANE_EXIT_INTERCEPT_TIMEOUT_SEC).toBe(
			"15",
		); // floor
		expect(
			buildWorkerEnv({ exitInterceptTimeoutSec: 99999 }).TASKPLANE_EXIT_INTERCEPT_TIMEOUT_SEC,
		).toBe("1800"); // cap
		expect(buildWorkerEnv({}).TASKPLANE_EXIT_INTERCEPT_TIMEOUT_SEC).toBe(undefined);
		const exec = readSrc("execution.ts").replace(/\s+/g, " ");
		expect(exec).toContain("return Number.isFinite(n) && n >= 15 ? Math.min(1800, n) : 60;");
		const lr = readSrc("lane-runner.ts").replace(/\s+/g, " ");
		expect(lr).toContain(
			"Math.min(1800, Math.max(15, config.exitInterceptTimeoutSec ?? 60)) * 1000;",
		);
		expect(lr).toContain(
			"exitInterceptSafetyMs: (Math.min(1800, Math.max(15, config.exitInterceptTimeoutSec ?? 60)) + 60) * 1000,",
		);
		const host = readSrc("agent-host.ts").replace(/\s+/g, " ");
		expect(host).toContain("const INTERCEPTION_TIMEOUT_MS = opts.exitInterceptSafetyMs ?? 120_000;");
		expect(readSrc("config-loader.ts")).toContain(
			"exitInterceptTimeoutSec: config.taskRunner.worker.exitInterceptTimeoutSec",
		);
	});
});
