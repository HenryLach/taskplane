import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const CLI_PATH = resolve(PROJECT_ROOT, "bin", "taskplane.mjs");

function buildProjectConfig(overrides: Record<string, any> = {}) {
	return {
		configVersion: 1,
		taskRunner: {
			worker: { model: "openai/gpt-5.3-codex", thinking: "on" },
			reviewer: { model: "anthropic/claude-sonnet-4-6", thinking: "off" },
		},
		orchestrator: {
			merge: { model: "openai/gpt-5.3-codex", thinking: "on" },
		},
		...overrides,
	};
}

describe("taskplane config --save-as-defaults", () => {
	it("writes current project model/thinking settings to global preferences", () => {
		const tempProject = mkdtempSync(join(tmpdir(), "taskplane-save-defaults-project-"));
		const tempAgentDir = mkdtempSync(join(tmpdir(), "taskplane-save-defaults-agent-"));

		try {
			mkdirSync(join(tempProject, ".pi"), { recursive: true });
			writeFileSync(
				join(tempProject, ".pi", "taskplane-config.json"),
				JSON.stringify(buildProjectConfig(), null, 2) + "\n",
				"utf-8",
			);

			const stdout = execFileSync("node", [CLI_PATH, "config", "--save-as-defaults"], {
				cwd: tempProject,
				encoding: "utf-8",
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: tempAgentDir,
				},
			});

			expect(stdout).toContain("Saved init defaults");

			const prefsPath = join(tempAgentDir, "taskplane", "preferences.json");
			const prefs = JSON.parse(readFileSync(prefsPath, "utf-8"));
			expect(prefs.initAgentDefaults).toEqual({
				workerModel: "openai/gpt-5.3-codex",
				reviewerModel: "anthropic/claude-sonnet-4-6",
				mergeModel: "openai/gpt-5.3-codex",
				workerThinking: "high",
				reviewerThinking: "off",
				mergeThinking: "high",
			});
		} finally {
			rmSync(tempProject, { recursive: true, force: true });
			rmSync(tempAgentDir, { recursive: true, force: true });
		}
	});

	it("resolves workspace pointer config path when saving defaults", () => {
		const workspaceRoot = mkdtempSync(join(tmpdir(), "taskplane-save-defaults-workspace-"));
		const tempAgentDir = mkdtempSync(join(tmpdir(), "taskplane-save-defaults-agent-"));

		try {
			const configRepo = join(workspaceRoot, "config-repo");
			const taskplaneDir = join(configRepo, ".taskplane");
			mkdirSync(taskplaneDir, { recursive: true });
			mkdirSync(join(workspaceRoot, ".pi"), { recursive: true });

			writeFileSync(
				join(taskplaneDir, "taskplane-config.json"),
				JSON.stringify(buildProjectConfig(), null, 2) + "\n",
				"utf-8",
			);
			writeFileSync(
				join(workspaceRoot, ".pi", "taskplane-pointer.json"),
				JSON.stringify({ config_repo: "config-repo", config_path: ".taskplane" }, null, 2) + "\n",
				"utf-8",
			);

			execFileSync("node", [CLI_PATH, "config", "--save-as-defaults"], {
				cwd: workspaceRoot,
				encoding: "utf-8",
				env: {
					...process.env,
					PI_CODING_AGENT_DIR: tempAgentDir,
				},
			});

			const prefsPath = join(tempAgentDir, "taskplane", "preferences.json");
			const prefs = JSON.parse(readFileSync(prefsPath, "utf-8"));
			expect(prefs.initAgentDefaults.workerModel).toBe("openai/gpt-5.3-codex");
			expect(prefs.initAgentDefaults.reviewerModel).toBe("anthropic/claude-sonnet-4-6");
			expect(prefs.initAgentDefaults.mergeModel).toBe("openai/gpt-5.3-codex");
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
			rmSync(tempAgentDir, { recursive: true, force: true });
		}
	});
});
