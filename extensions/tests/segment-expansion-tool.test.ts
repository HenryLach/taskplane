import { afterEach, describe, it } from "node:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";
import bridgeExtension from "../taskplane/agent-bridge-extension.ts";
import { buildSegmentId } from "../taskplane/types.ts";

interface RegisteredTool {
	name: string;
	execute: (toolCallId: string, params: any) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

function withEnv(overrides: Record<string, string>, fn: () => Promise<void> | void): Promise<void> | void {
	const keys = Object.keys(overrides);
	const previous = new Map<string, string | undefined>();
	for (const key of keys) {
		previous.set(key, process.env[key]);
		process.env[key] = overrides[key];
	}

	const run = () => fn();
	const cleanup = () => {
		for (const key of keys) {
			const oldValue = previous.get(key);
			if (oldValue === undefined) delete process.env[key];
			else process.env[key] = oldValue;
		}
	};

	try {
		const result = run();
		if (result && typeof (result as Promise<void>).then === "function") {
			return (result as Promise<void>).finally(cleanup);
		}
		cleanup();
		return result;
	} catch (err) {
		cleanup();
		throw err;
	}
}

function registerTools(): Map<string, RegisteredTool> {
	const tools = new Map<string, RegisteredTool>();
	const fakePi = {
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
	};
	bridgeExtension(fakePi as any);
	return tools;
}

function parsePayload(result: { content: Array<{ type: string; text: string }> }): any {
	return JSON.parse(result.content[0].text);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()!;
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("request_segment_expansion registration + autonomy guard", () => {
	it("is not registered when active segment context is missing", () => {
		withEnv({
			TASKPLANE_ACTIVE_SEGMENT_ID: "",
			TASKPLANE_OUTBOX_DIR: "",
		}, () => {
			const tools = registerTools();
			expect(tools.has("request_segment_expansion")).toBe(false);
		});
	});

	it("rejects non-autonomous calls with accepted=false and no file write", async () => {
		const outboxDir = mkdtempSync(join(tmpdir(), "tp-seg-expansion-"));
		tempDirs.push(outboxDir);

		await withEnv({
			TASKPLANE_OUTBOX_DIR: outboxDir,
			TASKPLANE_ACTIVE_SEGMENT_ID: "TP-777::api",
			TASKPLANE_TASK_ID: "TP-777",
			TASKPLANE_SUPERVISOR_AUTONOMY: "supervised",
		}, async () => {
			const tools = registerTools();
			expect(tools.has("request_segment_expansion")).toBe(true);

			const tool = tools.get("request_segment_expansion")!;
			const result = await tool.execute("call-1", {
				requestedRepoIds: ["web"],
				rationale: "Need cross-repo update",
			});
			const payload = parsePayload(result);
			expect(payload.accepted).toBe(false);
			expect(payload.requestId).toBe(null);
			expect(payload.message).toBe("Segment expansion requires autonomous supervisor mode");
			expect(readdirSync(outboxDir)).toEqual([]);
		});
	});

	it("rejects invalid repo IDs and writes no request file", async () => {
		const outboxDir = mkdtempSync(join(tmpdir(), "tp-seg-expansion-"));
		tempDirs.push(outboxDir);

		await withEnv({
			TASKPLANE_OUTBOX_DIR: outboxDir,
			TASKPLANE_ACTIVE_SEGMENT_ID: "TP-780::api",
			TASKPLANE_TASK_ID: "TP-780",
			TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous",
		}, async () => {
			const tool = registerTools().get("request_segment_expansion")!;
			const result = await tool.execute("call-invalid", {
				requestedRepoIds: ["Bad Repo"],
				rationale: "bad",
			});
			const payload = parsePayload(result);
			expect(payload.accepted).toBe(false);
			expect(payload.requestId).toBe(null);
			expect(payload.rejections[0].reason).toBe("invalid repo ID format");
			expect(readdirSync(outboxDir)).toEqual([]);
		});
	});

	it("rejects duplicate repo IDs within a single request", async () => {
		const outboxDir = mkdtempSync(join(tmpdir(), "tp-seg-expansion-"));
		tempDirs.push(outboxDir);

		await withEnv({
			TASKPLANE_OUTBOX_DIR: outboxDir,
			TASKPLANE_ACTIVE_SEGMENT_ID: "TP-781::api",
			TASKPLANE_TASK_ID: "TP-781",
			TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous",
		}, async () => {
			const tool = registerTools().get("request_segment_expansion")!;
			const result = await tool.execute("call-dup", {
				requestedRepoIds: ["web", "web"],
				rationale: "dup",
			});
			const payload = parsePayload(result);
			expect(payload.accepted).toBe(false);
			expect(payload.rejections[0].reason).toBe("duplicate repo ID in request");
			expect(readdirSync(outboxDir)).toEqual([]);
		});
	});

	it("rejects empty requestedRepoIds", async () => {
		const outboxDir = mkdtempSync(join(tmpdir(), "tp-seg-expansion-"));
		tempDirs.push(outboxDir);

		await withEnv({
			TASKPLANE_OUTBOX_DIR: outboxDir,
			TASKPLANE_ACTIVE_SEGMENT_ID: "TP-782::api",
			TASKPLANE_TASK_ID: "TP-782",
			TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous",
		}, async () => {
			const tool = registerTools().get("request_segment_expansion")!;
			const result = await tool.execute("call-empty", {
				requestedRepoIds: [],
				rationale: "empty",
			});
			const payload = parsePayload(result);
			expect(payload.accepted).toBe(false);
			expect(payload.rejections[0].reason).toBe("requestedRepoIds must be a non-empty array");
			expect(readdirSync(outboxDir)).toEqual([]);
		});
	});

	it("writes segment expansion request file with schema payload on valid input", async () => {
		const outboxDir = mkdtempSync(join(tmpdir(), "tp-seg-expansion-"));
		tempDirs.push(outboxDir);

		await withEnv({
			TASKPLANE_OUTBOX_DIR: outboxDir,
			TASKPLANE_ACTIVE_SEGMENT_ID: "TP-888::api",
			TASKPLANE_TASK_ID: "TP-888",
			TASKPLANE_SUPERVISOR_AUTONOMY: "autonomous",
		}, async () => {
			const tools = registerTools();
			const tool = tools.get("request_segment_expansion")!;
			const result = await tool.execute("call-2", {
				requestedRepoIds: ["web", "docs"],
				rationale: "Need docs + UI updates",
				placement: "end",
				edges: [{ from: "web", to: "docs" }],
			});
			const payload = parsePayload(result);
			expect(payload.accepted).toBe(true);
			expect(payload.requestId).toMatch(/^exp-\d{13}-[a-z0-9]{5}$/);

			const requestFile = join(outboxDir, `segment-expansion-${payload.requestId}.json`);
			const raw = readFileSync(requestFile, "utf-8");
			const parsed = JSON.parse(raw);
			expect(parsed.requestId).toBe(payload.requestId);
			expect(parsed.taskId).toBe("TP-888");
			expect(parsed.fromSegmentId).toBe("TP-888::api");
			expect(parsed.requestedRepoIds).toEqual(["web", "docs"]);
			expect(parsed.rationale).toBe("Need docs + UI updates");
			expect(parsed.placement).toBe("end");
			expect(parsed.edges).toEqual([{ from: "web", to: "docs" }]);
			expect(typeof parsed.timestamp).toBe("number");
			const files = readdirSync(outboxDir);
			expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
		});
	});
});


describe("segment ID helpers", () => {
	it("buildSegmentId appends sequence suffix when sequence >= 2", () => {
		expect(buildSegmentId("TP-900", "api", 2)).toBe("TP-900::api::2");
	});

	it("buildSegmentId preserves backward-compatible format without sequence", () => {
		expect(buildSegmentId("TP-901", "api")).toBe("TP-901::api");
	});
});

describe("autonomy wiring contracts", () => {
	it("threads supervisor autonomy from extension workerData into engine worker", () => {
		const extensionSrc = readFileSync(join(__dirname, "..", "taskplane", "extension.ts"), "utf-8");
		const workerSrc = readFileSync(join(__dirname, "..", "taskplane", "engine-worker.ts"), "utf-8");

		expect(extensionSrc).toContain("supervisorAutonomy: supervisorConfig.autonomy");
		expect(workerSrc).toContain("data.supervisorAutonomy ?? \"autonomous\"");
	});

	it("propagates autonomy through executeWave into lane-runner env", () => {
		const executionSrc = readFileSync(join(__dirname, "..", "taskplane", "execution.ts"), "utf-8");
		const laneRunnerSrc = readFileSync(join(__dirname, "..", "taskplane", "lane-runner.ts"), "utf-8");

		expect(executionSrc).toContain("TASKPLANE_SUPERVISOR_AUTONOMY: supervisorAutonomy");
		expect(executionSrc).toContain("extraEnvVars?.TASKPLANE_SUPERVISOR_AUTONOMY");
		expect(laneRunnerSrc).toContain("TASKPLANE_SUPERVISOR_AUTONOMY: config.supervisorAutonomy || \"autonomous\"");
	});
});
