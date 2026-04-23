/**
 * orch_resume tool harness tests
 *
 * Validates the registered extension tool surface, not just resume internals:
 * - extension.ts registers orch_resume
 * - session_start initializes execution context for the tool
 * - tool returns the immediate async launch message
 * - force propagates to worker init payload
 * - a second resume is blocked while the first remains launching
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { expect } from "./expect.ts";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockFork = mock.fn();
const mockBuildExecutionContext = mock.fn();
const mockRunMigrations = mock.fn(() => ({ messages: [] }));

class DummyWidget {
	constructor(..._args: any[]) {}
	addChild(..._args: any[]) {}
	factory() {
		return () => undefined;
	}
}

const Type = new Proxy({}, {
	get: () => (...args: any[]) => ({ args }),
});

const origChildProcess = await import("node:child_process");
const workspaceModuleUrl = new URL("../taskplane/workspace.ts", import.meta.url).href;
const configModuleUrl = new URL("../taskplane/config.ts", import.meta.url).href;
const migrationsModuleUrl = new URL("../taskplane/migrations.ts", import.meta.url).href;
const realWorkspace = await import(new URL("../taskplane/workspace.ts?orch-resume-tool-real", import.meta.url).href);
const realConfig = await import(new URL("../taskplane/config.ts?orch-resume-tool-real", import.meta.url).href);
const realMigrations = await import(new URL("../taskplane/migrations.ts?orch-resume-tool-real", import.meta.url).href);

mock.module("@mariozechner/pi-coding-agent", {
	namedExports: {
		BorderedLoader: DummyWidget,
		DynamicBorder: DummyWidget,
		getSettingsListTheme: () => ({}),
	},
});

mock.module("@mariozechner/pi-ai", {
	namedExports: {
		Type,
	},
});

mock.module("@mariozechner/pi-tui", {
	namedExports: {
		Box: DummyWidget,
		Container: DummyWidget,
		SelectList: DummyWidget,
		SettingsList: DummyWidget,
		Text: DummyWidget,
		truncateToWidth: (text: string) => text,
		visibleWidth: (text: string) => text.length,
		wrapTextWithAnsi: (text: string) => [text],
	},
});

mock.module("child_process", {
	namedExports: {
		...origChildProcess,
		fork: mockFork,
	},
});

mock.module(workspaceModuleUrl, {
	namedExports: {
		...realWorkspace,
		buildExecutionContext: mockBuildExecutionContext,
	},
});

mock.module(configModuleUrl, {
	namedExports: {
		...realConfig,
		loadSupervisorConfig: mock.fn(() => ({
			model: "",
			autonomy: "supervised",
		})),
	},
});

mock.module(migrationsModuleUrl, {
	namedExports: {
		...realMigrations,
		runMigrations: mockRunMigrations,
	},
});

const { default: taskplaneExtension } = await import("../taskplane/extension.ts");
const { DEFAULT_ORCHESTRATOR_CONFIG, DEFAULT_TASK_RUNNER_CONFIG } = await import("../taskplane/types.ts");

type ToolResult = { content: Array<{ type: string; text: string }>; details?: unknown };
type RegisteredTool = {
	name: string;
	execute: (
		toolCallId: string,
		params: any,
		signal?: AbortSignal,
		onUpdate?: ((update: unknown) => void) | undefined,
		ctx?: any,
	) => Promise<ToolResult>;
};

interface FakeChildProcess extends EventEmitter {
	stderr: EventEmitter;
	sent: unknown[];
	send: (message: unknown) => boolean;
	kill: () => boolean;
}

function makeFakeChild(): FakeChildProcess {
	const child = new EventEmitter() as FakeChildProcess;
	child.stderr = new EventEmitter();
	child.sent = [];
	child.send = (message: unknown) => {
		child.sent.push(message);
		return true;
	};
	child.kill = () => true;
	return child;
}

function makeFakePi() {
	const tools = new Map<string, RegisteredTool>();
	const listeners = new Map<string, Array<(...args: any[]) => any>>();

	return {
		tools,
		listeners,
		registerMessageRenderer() {},
		registerCommand() {},
		registerTool(tool: RegisteredTool) {
			tools.set(tool.name, tool);
		},
		on(event: string, handler: (...args: any[]) => any) {
			const list = listeners.get(event) ?? [];
			list.push(handler);
			listeners.set(event, list);
		},
		sendMessage() {},
		sendUserMessage() {},
	};
}

function makeSessionContext(cwd: string) {
	const notifications: Array<{ message: string; level: string }> = [];
	const statuses: Array<{ key: string; value: string }> = [];
	const widgets: Array<{ key: string; value: unknown }> = [];
	return {
		cwd,
		notifications,
		statuses,
		widgets,
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
			setStatus(key: string, value: string) {
				statuses.push({ key, value });
			},
			setWidget(key: string, value: unknown) {
				widgets.push({ key, value });
			},
			custom() {
				return undefined;
			},
		},
	};
}

let tmpDir = "";
let savedFetch: typeof globalThis.fetch | undefined;
let lastForkedChild: FakeChildProcess | null = null;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "tp-orch-resume-tool-"));
	mkdirSync(join(tmpDir, ".pi"), { recursive: true });
	mockFork.mock.resetCalls();
	mockBuildExecutionContext.mock.resetCalls();
	mockRunMigrations.mock.resetCalls();
	savedFetch = globalThis.fetch;
	globalThis.fetch = mock.fn(async () => ({ ok: false })) as typeof globalThis.fetch;
	mockBuildExecutionContext.mock.mockImplementation((cwd: string) => ({
		cwd,
		repoRoot: cwd,
		workspaceRoot: cwd,
		mode: "repo",
		workspaceConfig: null,
		pointer: null,
		orchestratorConfig: {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			orchestrator: {
				...DEFAULT_ORCHESTRATOR_CONFIG.orchestrator,
				integration: "manual",
			},
		},
		taskRunnerConfig: {
			...DEFAULT_TASK_RUNNER_CONFIG,
			task_areas: { default: "tasks" },
		},
	}));
	lastForkedChild = null;
	mockFork.mock.mockImplementation(() => {
		lastForkedChild = makeFakeChild();
		return lastForkedChild;
	});
});

afterEach(() => {
	if (savedFetch === undefined) {
		delete globalThis.fetch;
	} else {
		globalThis.fetch = savedFetch;
	}
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("orch_resume tool harness", () => {
	it("registers the tool and returns the async launch acknowledgement", async () => {
		const pi = makeFakePi();
		taskplaneExtension(pi as any);

		expect(pi.tools.has("orch_resume")).toBe(true);
		expect(pi.listeners.get("session_start")?.length).toBe(1);

		const sessionCtx = makeSessionContext(tmpDir);
		await pi.listeners.get("session_start")![0]({}, sessionCtx as any);

		const tool = pi.tools.get("orch_resume")!;
		const result = await tool.execute("call-1", { force: true }, undefined, undefined, sessionCtx as any);

		expect(result.content[0].text).toBe("🔄 Resume initiated for batch. Phase: launching.");
		expect(mockFork.mock.calls.length).toBe(1);

		expect(lastForkedChild).not.toBeNull();
		expect(lastForkedChild!.sent).toHaveLength(1);
		const initMessage = lastForkedChild!.sent[0] as { type: string; data: Record<string, unknown> };
		expect(initMessage.type).toBe("init");
		expect(initMessage.data.mode).toBe("resume");
		expect(initMessage.data.force).toBe(true);
		expect(initMessage.data.cwd).toBe(tmpDir);
		expect(initMessage.data.workspaceRoot).toBe(tmpDir);
	});

	it("blocks a second resume while the first remains launching", async () => {
		const pi = makeFakePi();
		taskplaneExtension(pi as any);
		const sessionCtx = makeSessionContext(tmpDir);
		await pi.listeners.get("session_start")![0]({}, sessionCtx as any);

		const tool = pi.tools.get("orch_resume")!;
		const first = await tool.execute("call-1", {}, undefined, undefined, sessionCtx as any);
		const second = await tool.execute("call-2", {}, undefined, undefined, sessionCtx as any);

		expect(first.content[0].text).toBe("🔄 Resume initiated for batch. Phase: launching.");
		expect(second.content[0].text).toContain("⚠️ A batch is currently launching");
		expect(second.content[0].text).toContain("Cannot resume");
		expect(mockFork.mock.calls.length).toBe(1);
	});
});