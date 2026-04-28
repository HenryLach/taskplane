/**
 * Tests for worker model/thinking/tools env var wiring — TP-183
 *
 * Covers:
 * - buildWorkerEnv emits correct env vars for each worker config field
 * - buildWorkerEnv omits keys when fields are empty/undefined
 * - buildWorkerEnv does NOT emit TASKPLANE_WORKER_EXCLUDE_EXTENSIONS
 *   (that env var is owned solely by buildWorkerExcludeEnv)
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { buildWorkerEnv } from "../taskplane/execution.ts";

describe("buildWorkerEnv", () => {
	it("returns empty object when config is null", () => {
		const result = buildWorkerEnv(null);
		assert.deepStrictEqual(result, {});
	});

	it("returns empty object when config is undefined", () => {
		const result = buildWorkerEnv(undefined);
		assert.deepStrictEqual(result, {});
	});

	it("emits TASKPLANE_WORKER_MODEL when model is set", () => {
		const result = buildWorkerEnv({ model: "gpt-4o" });
		assert.strictEqual(result.TASKPLANE_WORKER_MODEL, "gpt-4o");
	});

	it("omits TASKPLANE_WORKER_MODEL when model is empty string", () => {
		const result = buildWorkerEnv({ model: "" });
		assert.strictEqual(result.TASKPLANE_WORKER_MODEL, undefined);
	});

	it("emits TASKPLANE_WORKER_THINKING when thinking is set", () => {
		const result = buildWorkerEnv({ thinking: "high" });
		assert.strictEqual(result.TASKPLANE_WORKER_THINKING, "high");
	});

	it("omits TASKPLANE_WORKER_THINKING when thinking is empty", () => {
		const result = buildWorkerEnv({ thinking: "" });
		assert.strictEqual(result.TASKPLANE_WORKER_THINKING, undefined);
	});

	it("emits TASKPLANE_WORKER_TOOLS when tools is set", () => {
		const result = buildWorkerEnv({ tools: "read,write,bash" });
		assert.strictEqual(result.TASKPLANE_WORKER_TOOLS, "read,write,bash");
	});

	it("omits TASKPLANE_WORKER_TOOLS when tools is empty", () => {
		const result = buildWorkerEnv({ tools: "" });
		assert.strictEqual(result.TASKPLANE_WORKER_TOOLS, undefined);
	});

	it("does NOT emit TASKPLANE_WORKER_EXCLUDE_EXTENSIONS (owned by buildWorkerExcludeEnv)", () => {
		const result = buildWorkerEnv({
			model: "gpt-4o",
			excludeExtensions: ["some-package"],
		});
		assert.strictEqual(result.TASKPLANE_WORKER_EXCLUDE_EXTENSIONS, undefined,
			"buildWorkerEnv should not set exclude extensions — buildWorkerExcludeEnv owns that var");
	});

	it("handles all fields simultaneously", () => {
		const result = buildWorkerEnv({
			model: "gpt-4o",
			thinking: "on",
			tools: "read,write,bash",
		});
		assert.strictEqual(result.TASKPLANE_WORKER_MODEL, "gpt-4o");
		assert.strictEqual(result.TASKPLANE_WORKER_THINKING, "on");
		assert.strictEqual(result.TASKPLANE_WORKER_TOOLS, "read,write,bash");
	});

	it("omits all env keys when all fields are empty", () => {
		const result = buildWorkerEnv({ model: "", thinking: "", tools: "" });
		assert.strictEqual(Object.keys(result).length, 0);
	});
});
