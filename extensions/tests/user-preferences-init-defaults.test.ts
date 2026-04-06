import { afterEach, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "./expect.ts";
import { loadGlobalPreferences } from "../taskplane/config-loader.ts";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	}
});

describe("global preferences initAgentDefaults allowlist", () => {
	it("loads and sanitizes initAgentDefaults from preferences.json", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "taskplane-prefs-init-defaults-"));
		process.env.PI_CODING_AGENT_DIR = agentDir;

		try {
			const prefsDir = join(agentDir, "taskplane");
			mkdirSync(prefsDir, { recursive: true });
			writeFileSync(
				join(prefsDir, "preferences.json"),
				JSON.stringify({
					initAgentDefaults: {
						workerModel: "openai/gpt-5.3-codex",
						reviewerModel: "anthropic/claude-sonnet-4-6",
						mergeModel: "openai/gpt-5.3-codex",
						workerThinking: "ON",
						reviewerThinking: "invalid-value",
						mergeThinking: "off",
						ignored: "nope",
					},
				}),
				"utf-8",
			);

			const prefs = loadGlobalPreferences();
			expect(prefs.initAgentDefaults).toEqual({
				workerModel: "openai/gpt-5.3-codex",
				reviewerModel: "anthropic/claude-sonnet-4-6",
				mergeModel: "openai/gpt-5.3-codex",
				workerThinking: "high",
				reviewerThinking: "",
				mergeThinking: "off",
			});
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
});
