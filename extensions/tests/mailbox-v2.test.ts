/**
 * Mailbox V2 Tests — TP-106
 *
 * Tests for outbox, broadcast, rate limiting, and registry-backed
 * supervisor tool contracts.
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/mailbox-v2.test.ts
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "./expect.ts";
import { mkdtempSync, existsSync, readFileSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import {
	writeOutboxMessage,
	readOutbox,
	writeBroadcastMessage,
	sessionOutboxDir,
	checkRateLimit,
	recordSend,
	_resetRateLimits,
	RATE_LIMIT_WINDOW_MS,
} from "../taskplane/mailbox.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionSrc = readFileSync(join(__dirname, "..", "taskplane", "extension.ts"), "utf-8");

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "tp-mailbox-v2-test-"));
	_resetRateLimits();
});

afterEach(() => {
	try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
	_resetRateLimits();
});

// ── 1. Outbox ────────────────────────────────────────────────────────

describe("1.x: Agent outbox", () => {
	const batchId = "test-batch";
	const agentId = "orch-test-lane-1-worker";

	it("1.1: writeOutboxMessage creates file in outbox directory", () => {
		const msg = writeOutboxMessage(tmpDir, batchId, agentId, {
			from: agentId,
			type: "reply",
			content: "Acknowledged the steering message.",
		});
		const outDir = sessionOutboxDir(tmpDir, batchId, agentId);
		expect(existsSync(outDir)).toBe(true);
		const files = readdirSync(outDir).filter(f => f.endsWith(".msg.json"));
		expect(files.length).toBe(1);
		expect(msg.to).toBe("supervisor");
		expect(msg.type).toBe("reply");
	});

	it("1.2: readOutbox returns messages sorted by timestamp", () => {
		writeOutboxMessage(tmpDir, batchId, agentId, { from: agentId, type: "reply", content: "first" });
		writeOutboxMessage(tmpDir, batchId, agentId, { from: agentId, type: "escalate", content: "second" });
		const messages = readOutbox(tmpDir, batchId, agentId);
		expect(messages.length).toBe(2);
		expect(messages[0].content).toBe("first");
		expect(messages[1].content).toBe("second");
	});

	it("1.3: readOutbox returns empty array for non-existent agent", () => {
		expect(readOutbox(tmpDir, batchId, "nonexistent")).toEqual([]);
	});

	it("1.4: outbox message has correct envelope fields", () => {
		const msg = writeOutboxMessage(tmpDir, batchId, agentId, {
			from: agentId,
			type: "escalate",
			content: "I'm blocked on Step 3.",
			expectsReply: true,
		});
		expect(msg.batchId).toBe(batchId);
		expect(msg.from).toBe(agentId);
		expect(msg.to).toBe("supervisor");
		expect(msg.type).toBe("escalate");
		expect(msg.expectsReply).toBe(true);
		expect(typeof msg.id).toBe("string");
		expect(typeof msg.timestamp).toBe("number");
	});

	it("1.5: outbox enforces 4KB limit", () => {
		const bigContent = "x".repeat(5000);
		let threw = false;
		try {
			writeOutboxMessage(tmpDir, batchId, agentId, { from: agentId, type: "reply", content: bigContent });
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
	});
});

// ── 2. Broadcast ─────────────────────────────────────────────────────

describe("2.x: Broadcast messages", () => {
	const batchId = "test-batch";

	it("2.1: writeBroadcastMessage creates file in _broadcast/inbox", () => {
		const msg = writeBroadcastMessage(tmpDir, batchId, {
			from: "supervisor",
			type: "info",
			content: "All agents: wrap up current step.",
		});
		const broadcastInbox = join(tmpDir, ".pi", "mailbox", batchId, "_broadcast", "inbox");
		expect(existsSync(broadcastInbox)).toBe(true);
		const files = readdirSync(broadcastInbox).filter(f => f.endsWith(".msg.json"));
		expect(files.length).toBe(1);
		expect(msg.to).toBe("_broadcast");
	});
});

// ── 3. Rate limiting ─────────────────────────────────────────────────

describe("3.x: Rate limiting", () => {
	it("3.1: first send is allowed", () => {
		const result = checkRateLimit("agent-1");
		expect(result.allowed).toBe(true);
	});

	it("3.2: immediate second send is blocked", () => {
		recordSend("agent-1");
		const result = checkRateLimit("agent-1");
		expect(result.allowed).toBe(false);
		expect(typeof result.retryAfterMs).toBe("number");
		expect(result.retryAfterMs!).toBeGreaterThan(0);
	});

	it("3.3: different agents have independent limits", () => {
		recordSend("agent-1");
		const result = checkRateLimit("agent-2");
		expect(result.allowed).toBe(true);
	});

	it("3.4: _resetRateLimits clears all limits", () => {
		recordSend("agent-1");
		_resetRateLimits();
		const result = checkRateLimit("agent-1");
		expect(result.allowed).toBe(true);
	});

	it("3.5: RATE_LIMIT_WINDOW_MS is 30 seconds", () => {
		expect(RATE_LIMIT_WINDOW_MS).toBe(30_000);
	});
});

// ── 4. Registry-backed supervisor tools (source contract) ────────────

describe("4.x: Registry-backed supervisor tool contracts", () => {
	it("4.1: send_agent_message checks registry before TMUX", () => {
		const fnIdx = extensionSrc.indexOf("function doSendAgentMessage(");
		const block = extensionSrc.slice(fnIdx, fnIdx + 3000);
		expect(block).toContain("readRegistrySnapshot");
		expect(block).toContain("isTerminalStatus");
		expect(block).toContain("registryIsProcessAlive");
		// TMUX is only a fallback
		expect(block).toContain("tmuxHasSession(to)");
	});

	it("4.2: send_agent_message applies rate limiting", () => {
		const fnIdx = extensionSrc.indexOf("function doSendAgentMessage(");
		const block = extensionSrc.slice(fnIdx, fnIdx + 3500);
		expect(block).toContain("checkRateLimit(to)");
		expect(block).toContain("recordSend(to)");
		expect(block).toContain("Rate limited");
	});

	it("4.3: list_active_agents checks registry first", () => {
		const fnIdx = extensionSrc.indexOf("function doListActiveAgents(");
		const block = extensionSrc.slice(fnIdx, fnIdx + 1000);
		expect(block).toContain("readRegistrySnapshot");
		expect(block).toContain("formatRegistryAgents");
	});

	it("4.4: read_agent_replies tool is registered", () => {
		expect(extensionSrc).toContain('"read_agent_replies"');
		expect(extensionSrc).toContain("doReadAgentReplies");
	});

	it("4.5: broadcast_message tool is registered", () => {
		expect(extensionSrc).toContain('"broadcast_message"');
		expect(extensionSrc).toContain("doBroadcastMessage");
	});

	it("4.6: read_agent_replies reads outbox", () => {
		expect(extensionSrc).toContain("readOutbox(stateRoot");
	});

	it("4.7: broadcast_message calls writeBroadcastMessage", () => {
		expect(extensionSrc).toContain("writeBroadcastMessage(stateRoot");
	});
});

// ── 5. Broadcast delivery in agent-host (TP-106 remediation) ──────

describe("5.x: Agent-host broadcast delivery", () => {
	const agentHostSrc = readFileSync(join(__dirname, "..", "taskplane", "agent-host.ts"), "utf-8");

	it("8.1: checkMailbox reads _broadcast/inbox in addition to own inbox", () => {
		expect(agentHostSrc).toContain("_broadcast");
		expect(agentHostSrc).toContain("broadcastInbox");
		expect(agentHostSrc).toContain("isBroadcast");
	});

	it("8.2: broadcast messages are validated with to === _broadcast", () => {
		expect(agentHostSrc).toContain('msg.to !== "_broadcast"');
	});
});

// ── 6. Registry wiring in lane-runner (TP-106 remediation) ────────

describe("6.x: Lane-runner registry and outbox wiring", () => {
	const laneRunnerSrc = readFileSync(join(__dirname, "..", "taskplane", "lane-runner.ts"), "utf-8");

	it("6.1: lane-runner writes registry snapshot", () => {
		expect(laneRunnerSrc).toContain("writeRegistrySnapshot");
		expect(laneRunnerSrc).toContain("buildRegistrySnapshot");
	});

	it("6.2: lane-runner polls outbox after worker exit", () => {
		expect(laneRunnerSrc).toContain("readOutbox");
	});
});

// ── 7. Agent bridge extension exists (TP-106 remediation) ────────

describe("7.x: Agent bridge extension", () => {
	it("7.1: agent-bridge-extension.ts exists and exports default", async () => {
		const mod = await import("../taskplane/agent-bridge-extension.ts");
		expect(typeof mod.default).toBe("function");
	});

	it("7.2: provides notify_supervisor tool", () => {
		const src = readFileSync(join(__dirname, "..", "taskplane", "agent-bridge-extension.ts"), "utf-8");
		expect(src).toContain('"notify_supervisor"');
	});

	it("7.3: provides escalate_to_supervisor tool", () => {
		const src = readFileSync(join(__dirname, "..", "taskplane", "agent-bridge-extension.ts"), "utf-8");
		expect(src).toContain('"escalate_to_supervisor"');
	});

	it("7.4: writes to outbox directory via TASKPLANE_OUTBOX_DIR", () => {
		const src = readFileSync(join(__dirname, "..", "taskplane", "agent-bridge-extension.ts"), "utf-8");
		expect(src).toContain("TASKPLANE_OUTBOX_DIR");
	});

	it("7.5: uses atomic write (tmp + rename)", () => {
		const src = readFileSync(join(__dirname, "..", "taskplane", "agent-bridge-extension.ts"), "utf-8");
		expect(src).toContain(".msg.json.tmp");
		expect(src).toContain("renameSync");
	});
});

// ── 8. Export validation ─────────────────────────────────────────────

describe("8.x: Mailbox V2 exports", () => {
	it("8.1: writeOutboxMessage is a function", () => {
		expect(typeof writeOutboxMessage).toBe("function");
	});

	it("8.2: readOutbox is a function", () => {
		expect(typeof readOutbox).toBe("function");
	});

	it("8.3: writeBroadcastMessage is a function", () => {
		expect(typeof writeBroadcastMessage).toBe("function");
	});

	it("8.4: checkRateLimit is a function", () => {
		expect(typeof checkRateLimit).toBe("function");
	});

	it("8.5: recordSend is a function", () => {
		expect(typeof recordSend).toBe("function");
	});

	it("8.6: sessionOutboxDir is a function", () => {
		expect(typeof sessionOutboxDir).toBe("function");
	});
});
