/**
 * TP-089 mailbox follow-up guards
 *
 * Source-based regression tests for:
 * - send_agent_message runtime guards (terminal phase + live tmux session)
 * - workspace-root artifact cleanup wiring in orch-integrate paths
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionSource = readFileSync(join(__dirname, "..", "taskplane", "extension.ts"), "utf-8");

describe("send_agent_message guards", () => {
	it("checks for terminal batch phases before writing mailbox messages", () => {
		expect(extensionSource).toContain("isBatchTerminal(state.phase)");
		expect(extensionSource).toContain("terminal phase");
	});

	it("checks target tmux session liveness before confirming send", () => {
		expect(extensionSource).toContain("tmuxHasSession(to)");
		expect(extensionSource).toContain("is not currently running");
	});
});

describe("workspace-root cleanup wiring", () => {
	it("buildIntegrationExecutor uses stateRoot override for cleanupPostIntegrate", () => {
		expect(extensionSource).toContain("buildIntegrationExecutor(repoRoot: string, opId?: string, stateRoot?: string)");
		expect(extensionSource).toContain("cleanupPostIntegrate(stateRoot ?? repoRoot, context.batchId)");
	});

	it("/orch-integrate manual path cleans up artifacts from execCtx.workspaceRoot", () => {
		expect(extensionSource).toContain("const stateRoot = execCtx!.workspaceRoot;");
		expect(extensionSource).toContain("cleanupPostIntegrate(stateRoot, batchId)");
	});
});
