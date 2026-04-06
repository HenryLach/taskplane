import { afterEach, describe, it } from "node:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect } from "./expect.ts";
import bridgeExtension from "../taskplane/agent-bridge-extension.ts";

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
});
