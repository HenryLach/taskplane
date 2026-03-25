/**
 * Supervisor Template Pattern Tests — TP-058
 *
 * Tests for the supervisor template loading, composition, and fallback:
 *
 *   1.x — Template file existence: base + local scaffold + routing template exist
 *   2.x — Template content: required sections, placeholder variables defined
 *   3.x — Template composition: base + local override, standalone mode
 *   4.x — Prompt builder integration: templates loaded and variables replaced
 *   5.x — Fallback: missing template → inline prompt still works
 *   6.x — Init integration: supervisor template in init file lists
 *
 * Run: npx vitest run tests/supervisor-template.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import {
	buildSupervisorSystemPrompt,
	buildRoutingSystemPrompt,
	loadSupervisorTemplate,
} from "../taskplane/supervisor.ts";

import { freshOrchBatchState, DEFAULT_ORCHESTRATOR_CONFIG } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, "..", "..", "templates", "agents");

// ═════════════════════════════════════════════════════════════════════
// Test helpers
// ═════════════════════════════════════════════════════════════════════

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "supervisor-tpl-test-"));
}

function makeTestBatchState(overrides?: Partial<ReturnType<typeof freshOrchBatchState>>) {
	const state = freshOrchBatchState();
	state.batchId = "20260322T120000";
	state.baseBranch = "main";
	state.orchBranch = "orch/test-20260322T120000";
	state.phase = "executing";
	state.totalWaves = 3;
	state.currentWaveIndex = 1;
	state.totalTasks = 10;
	state.succeededTasks = 4;
	state.failedTasks = 1;
	state.skippedTasks = 0;
	state.blockedTasks = 0;
	if (overrides) Object.assign(state, overrides);
	return state;
}

// ═════════════════════════════════════════════════════════════════════
// 1.x — Template file existence
// ═════════════════════════════════════════════════════════════════════

describe("1.x — Template file existence", () => {
	it("1.1: base supervisor template exists", () => {
		expect(existsSync(join(TEMPLATES_DIR, "supervisor.md"))).toBe(true);
	});

	it("1.2: base supervisor-routing template exists", () => {
		expect(existsSync(join(TEMPLATES_DIR, "supervisor-routing.md"))).toBe(true);
	});

	it("1.3: local supervisor scaffold exists", () => {
		expect(existsSync(join(TEMPLATES_DIR, "local", "supervisor.md"))).toBe(true);
	});
});

// ═════════════════════════════════════════════════════════════════════
// 2.x — Template content validation
// ═════════════════════════════════════════════════════════════════════

describe("2.x — Template content: required sections and placeholders", () => {
	// Normalize CRLF→LF for cross-platform compatibility
	const supervisorTemplate = readFileSync(join(TEMPLATES_DIR, "supervisor.md"), "utf-8").replace(/\r\n/g, "\n");
	const routingTemplate = readFileSync(join(TEMPLATES_DIR, "supervisor-routing.md"), "utf-8").replace(/\r\n/g, "\n");
	const localTemplate = readFileSync(join(TEMPLATES_DIR, "local", "supervisor.md"), "utf-8").replace(/\r\n/g, "\n");

	it("2.1: supervisor template has frontmatter with name", () => {
		expect(supervisorTemplate).toMatch(/^---\n/);
		expect(supervisorTemplate).toContain("name: supervisor");
	});

	it("2.2: supervisor template has required sections", () => {
		expect(supervisorTemplate).toContain("# Supervisor Agent");
		expect(supervisorTemplate).toContain("## Identity");
		expect(supervisorTemplate).toContain("## Current Batch Context");
		expect(supervisorTemplate).toContain("## Standing Orders");
		expect(supervisorTemplate).toContain("## Recovery Action Classification");
		expect(supervisorTemplate).toContain("## Audit Trail");
		expect(supervisorTemplate).toContain("## Available Orchestrator Tools");
		expect(supervisorTemplate).toContain("## Startup Checklist");
	});

	it("2.3: supervisor template has required placeholder variables", () => {
		expect(supervisorTemplate).toContain("{{batchId}}");
		expect(supervisorTemplate).toContain("{{phase}}");
		expect(supervisorTemplate).toContain("{{baseBranch}}");
		expect(supervisorTemplate).toContain("{{orchBranch}}");
		expect(supervisorTemplate).toContain("{{autonomy}}");
		expect(supervisorTemplate).toContain("{{batchStatePath}}");
		expect(supervisorTemplate).toContain("{{eventsPath}}");
		expect(supervisorTemplate).toContain("{{actionsPath}}");
		expect(supervisorTemplate).toContain("{{primerPath}}");
		expect(supervisorTemplate).toContain("{{guardrailsSection}}");
		expect(supervisorTemplate).toContain("{{autonomyGuidance}}");
	});

	it("2.4: routing template has frontmatter with name", () => {
		expect(routingTemplate).toMatch(/^---\n/);
		expect(routingTemplate).toContain("name: supervisor-routing");
	});

	it("2.5: routing template has required placeholders", () => {
		expect(routingTemplate).toContain("{{routingState}}");
		expect(routingTemplate).toContain("{{contextMessage}}");
		expect(routingTemplate).toContain("{{scriptGuidance}}");
		expect(routingTemplate).toContain("{{primerPath}}");
	});

	it("2.6: local scaffold has frontmatter with name", () => {
		expect(localTemplate).toMatch(/^---\n/);
		expect(localTemplate).toContain("name: supervisor");
	});

	it("2.7: local scaffold has guidance comments", () => {
		expect(localTemplate).toContain("Project-Specific Supervisor Guidance");
		expect(localTemplate).toContain("COMPOSED with the base supervisor prompt");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 3.x — Template composition (base + local override)
// ═════════════════════════════════════════════════════════════════════

describe("3.x — Template composition: base + local override", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("3.1: loads base template when no local override exists", () => {
		const result = loadSupervisorTemplate("supervisor", tmpDir);
		expect(result).not.toBeNull();
		expect(result!).toContain("Supervisor Agent");
		expect(result!).toContain("{{batchId}}");
	});

	it("3.2: composes base + local override", () => {
		const agentDir = join(tmpDir, ".pi", "agents");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "supervisor.md"), `---
name: supervisor
---
Always run the linter before integration.
`);

		const result = loadSupervisorTemplate("supervisor", tmpDir);
		expect(result).not.toBeNull();
		// Should contain base content
		expect(result!).toContain("Supervisor Agent");
		// Should contain local override with separator
		expect(result!).toContain("Project-Specific Guidance");
		expect(result!).toContain("Always run the linter before integration.");
	});

	it("3.3: standalone mode uses local only, ignores base", () => {
		const agentDir = join(tmpDir, ".pi", "agents");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "supervisor.md"), `---
name: supervisor
standalone: true
---
Custom standalone supervisor prompt.
`);

		const result = loadSupervisorTemplate("supervisor", tmpDir);
		expect(result).not.toBeNull();
		expect(result!).toBe("Custom standalone supervisor prompt.");
		// Should NOT contain base content
		expect(result!).not.toContain("batch supervisor");
	});

	it("3.4: returns null when neither base nor local found", () => {
		const result = loadSupervisorTemplate("nonexistent-agent", tmpDir);
		expect(result).toBeNull();
	});

	it("3.5: loads routing template", () => {
		const result = loadSupervisorTemplate("supervisor-routing", tmpDir);
		expect(result).not.toBeNull();
		expect(result!).toContain("Project Supervisor");
		expect(result!).toContain("{{routingState}}");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 4.x — Prompt builder integration (templates + variable replacement)
// ═════════════════════════════════════════════════════════════════════

describe("4.x — Prompt builder: template loading + variable replacement", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("4.1: buildSupervisorSystemPrompt replaces all template variables", () => {
		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };

		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, tmpDir);

		// All placeholders should be replaced
		expect(prompt).not.toContain("{{batchId}}");
		expect(prompt).not.toContain("{{phase}}");
		expect(prompt).not.toContain("{{autonomy}}");
		expect(prompt).not.toContain("{{guardrailsSection}}");
		expect(prompt).not.toContain("{{autonomyGuidance}}");

		// Dynamic values should be present
		expect(prompt).toContain("20260322T120000");
		expect(prompt).toContain("executing");
		expect(prompt).toContain("supervised");
		expect(prompt).toContain("SUPERVISED");
	});

	it("4.2: buildSupervisorSystemPrompt includes local override content", () => {
		const agentDir = join(tmpDir, ".pi", "agents");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "supervisor.md"), `---
name: supervisor
---
Check CI dashboard at https://ci.example.com before approving merges.
`);

		const batchState = makeTestBatchState();
		const config = DEFAULT_ORCHESTRATOR_CONFIG;
		const supervisorConfig = { model: "", autonomy: "supervised" as const };

		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, tmpDir);

		expect(prompt).toContain("batch supervisor");
		expect(prompt).toContain("Check CI dashboard at https://ci.example.com");
	});

	it("4.3: buildRoutingSystemPrompt replaces all template variables", () => {
		const routingContext = {
			routingState: "pending-tasks" as const,
			contextMessage: "Found 5 pending tasks in taskplane-tasks/",
		};

		const prompt = buildRoutingSystemPrompt(routingContext, tmpDir);

		// All placeholders should be replaced
		expect(prompt).not.toContain("{{routingState}}");
		expect(prompt).not.toContain("{{contextMessage}}");
		expect(prompt).not.toContain("{{scriptGuidance}}");

		// Dynamic values should be present
		expect(prompt).toContain("pending-tasks");
		expect(prompt).toContain("Found 5 pending tasks");
		expect(prompt).toContain("Batch Planning");
	});

	it("4.4: supervisor prompt includes guardrails for manual integration mode", () => {
		const batchState = makeTestBatchState();
		const config = {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			orchestrator: { ...DEFAULT_ORCHESTRATOR_CONFIG.orchestrator, integration: "manual" },
		};
		const supervisorConfig = { model: "", autonomy: "supervised" as const };

		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, tmpDir);

		expect(prompt).toContain("Never `git push` to any remote");
		expect(prompt).not.toContain("Integration Permissions");
	});

	it("4.5: supervisor prompt includes integration permissions for supervised mode", () => {
		const batchState = makeTestBatchState();
		const config = {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			orchestrator: { ...DEFAULT_ORCHESTRATOR_CONFIG.orchestrator, integration: "supervised" },
		};
		const supervisorConfig = { model: "", autonomy: "supervised" as const };

		const prompt = buildSupervisorSystemPrompt(batchState, config, supervisorConfig, tmpDir);

		expect(prompt).toContain("Integration Permissions (mode: supervised)");
		expect(prompt).toContain("Supervised mode:");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 5.x — Fallback (missing template → inline prompt)
// ═════════════════════════════════════════════════════════════════════

describe("5.x — Fallback: inline prompt when template is missing", () => {
	it("5.1: loadSupervisorTemplate returns null for missing template", () => {
		const result = loadSupervisorTemplate("nonexistent-template", "/tmp/nowhere");
		expect(result).toBeNull();
	});

	// Note: We can't easily test the fallback path in buildSupervisorSystemPrompt
	// without mocking file system access. The existing supervisor.test.ts tests
	// (1.x series) verify the prompt content, which works whether the template
	// is loaded or the inline fallback fires.
});

// ═════════════════════════════════════════════════════════════════════
// 6.x — Init integration (supervisor in file lists)
// ═════════════════════════════════════════════════════════════════════

describe("6.x — Init integration: supervisor template in CLI", () => {
	it("6.1: local scaffold exists and can be used as init source", () => {
		const localPath = join(TEMPLATES_DIR, "local", "supervisor.md");
		expect(existsSync(localPath)).toBe(true);

		const content = readFileSync(localPath, "utf-8");
		// Should be a valid agent file with frontmatter
		expect(content).toMatch(/^---\r?\n/);
		expect(content).toContain("name: supervisor");
	});

	it("6.2: init file list includes supervisor.md", () => {
		// Read the CLI source and verify supervisor.md is in the init agent list
		const cliSource = readFileSync(resolve(__dirname, "..", "..", "bin", "taskplane.mjs"), "utf-8");

		// Both repo mode and workspace mode init should include supervisor.md
		const agentListMatches = cliSource.match(/for \(const agent of \[.*?"supervisor\.md".*?\]\)/gs);
		expect(agentListMatches).not.toBeNull();
		expect(agentListMatches!.length).toBeGreaterThanOrEqual(2); // repo + workspace mode
	});

	it("6.3: doctor config files include supervisor.md", () => {
		const cliSource = readFileSync(resolve(__dirname, "..", "..", "bin", "taskplane.mjs"), "utf-8");

		expect(cliSource).toContain('"agents/supervisor.md"');
	});
});
