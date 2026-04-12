/**
 * Exit Interception Tests — TP-172
 *
 * Tests for the supervisor-in-the-loop worker exit interception feature:
 *   - agent-host onPrematureExit callback and maxExitInterceptions
 *   - lane-runner supervisor escalation, timeout fallback, and reply interpretation
 *   - end-to-end interception flow contracts
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/exit-interception.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const agentHostSrc = readFileSync(join(__dirname, "..", "taskplane", "agent-host.ts"), "utf-8");
const laneRunnerSrc = readFileSync(join(__dirname, "..", "taskplane", "lane-runner.ts"), "utf-8");
const typesSrc = readFileSync(join(__dirname, "..", "taskplane", "types.ts"), "utf-8");
const supervisorPrimerSrc = readFileSync(join(__dirname, "..", "taskplane", "supervisor-primer.md"), "utf-8");

// ── 1. Agent-host exit interception contract ────────────────────────

describe("1.x: Agent-host exit interception (TP-172)", () => {
	it("1.1: AgentHostOptions has onPrematureExit callback", () => {
		expect(agentHostSrc).toContain("onPrematureExit?: (assistantMessage: string) => Promise<string | null>");
	});

	it("1.2: AgentHostOptions has maxExitInterceptions option", () => {
		expect(agentHostSrc).toContain("maxExitInterceptions?: number");
	});

	it("1.3: maxExitInterceptions defaults to 3", () => {
		expect(agentHostSrc).toContain("maxExitInterceptions ?? 3");
	});

	it("1.4: agent_end handler checks onPrematureExit callback before closeStdin", () => {
		const agentEndIdx = agentHostSrc.indexOf('case "agent_end"');
		const block = agentHostSrc.slice(agentEndIdx, agentEndIdx + 4000);
		expect(block).toContain("opts.onPrematureExit");
		expect(block).toContain("exitInterceptionCount < maxExitInterceptions");
		// closeStdin should only be called conditionally, not unconditionally
		expect(block).toContain("closeStdin()");
	});

	it("1.5: interception sends new prompt via stdin when callback returns string", () => {
		const agentEndIdx = agentHostSrc.indexOf('case "agent_end"');
		const block = agentHostSrc.slice(agentEndIdx, agentEndIdx + 2500);
		expect(block).toContain('type: "prompt", message: newPrompt');
		// agentEnded must be reset for the new turn
		expect(block).toContain("agentEnded = false");
	});

	it("1.6: interception closes session when callback returns null", () => {
		const agentEndIdx = agentHostSrc.indexOf('case "agent_end"');
		const block = agentHostSrc.slice(agentEndIdx, agentEndIdx + 4000);
		expect(block).toContain("closeStdin()");
	});

	it("1.7: interception limit forces session close", () => {
		const agentEndIdx = agentHostSrc.indexOf('case "agent_end"');
		const block = agentHostSrc.slice(agentEndIdx, agentEndIdx + 4000);
		expect(block).toContain("exitInterceptionCount >= maxExitInterceptions");
		expect(block).toContain("max_interceptions_reached");
	});

	it("1.8: exit_intercepted telemetry emitted with full payload", () => {
		// Verify all required payload fields exist in exit_intercepted events
		expect(agentHostSrc).toContain('"exit_intercepted"');
		expect(agentHostSrc).toContain("interceptionCount:");
		expect(agentHostSrc).toContain("assistantMessage:");
		expect(agentHostSrc).toContain("supervisorConsulted:");
		expect(agentHostSrc).toContain("action: \"reprompt\"");
		expect(agentHostSrc).toContain("action: \"close\"");
	});

	it("1.9: callback invocation is wrapped for synchronous throw safety", () => {
		// Must use Promise.resolve().then() or equivalent to catch sync throws
		expect(agentHostSrc).toContain("Promise.resolve().then(() =>");
		expect(agentHostSrc).toContain("onPrematureExit!(lastAssistantMessage)");
	});

	it("1.10: interception has bounded timeout (2 minutes)", () => {
		expect(agentHostSrc).toContain("INTERCEPTION_TIMEOUT_MS = 120_000");
		expect(agentHostSrc).toContain("Promise.race([interceptPromise, timeoutPromise])");
	});

	it("1.11: exit_intercepted includes reason field for diagnostics", () => {
		expect(agentHostSrc).toContain('reason: "callback_error"');
		// callback_returned_null and stdin_closed are variable assignments used as reason values
		expect(agentHostSrc).toContain('"callback_returned_null"');
		expect(agentHostSrc).toContain('"stdin_closed"');
		expect(agentHostSrc).toContain('reason: "max_interceptions_reached"');
	});

	it("1.12: last assistant message is tracked from message_end events", () => {
		expect(agentHostSrc).toContain("lastAssistantMessage = content");
		expect(agentHostSrc).toContain("let lastAssistantMessage = ");
	});

	it("1.13: exit_intercepted is a valid RuntimeAgentEventType", () => {
		expect(typesSrc).toContain('"exit_intercepted"');
	});
});

// ── 2. Lane-runner supervisor escalation contract ───────────────────

describe("2.x: Lane-runner supervisor escalation (TP-172)", () => {
	it("2.1: hostOpts includes onPrematureExit callback", () => {
		expect(laneRunnerSrc).toContain("onPrematureExit:");
	});

	it("2.2: callback only fires when onSupervisorAlert is available", () => {
		expect(laneRunnerSrc).toContain("config.onSupervisorAlert");
		// Should be conditional — undefined when no supervisor alert callback
		expect(laneRunnerSrc).toContain(": undefined,");
	});

	it("2.3: callback checks checkbox progress before escalating", () => {
		expect(laneRunnerSrc).toContain("midTotalChecked > prevTotalChecked");
	});

	it("2.4: callback checks blocker section for progress", () => {
		expect(laneRunnerSrc).toContain("## Blockers");
		expect(laneRunnerSrc).toContain('"*None*"');
		// Worker that logs a blocker should not be escalated
		expect(laneRunnerSrc).toContain("Worker logged a blocker");
	});

	it("2.5: escalation alert has correct category", () => {
		expect(laneRunnerSrc).toContain('category: "worker-exit-intercept"');
	});

	it("2.6: escalation message includes worker context", () => {
		expect(laneRunnerSrc).toContain("Worker on lane");
		expect(laneRunnerSrc).toContain("Worker said:");
		expect(laneRunnerSrc).toContain("Unchecked items:");
		expect(laneRunnerSrc).toContain("Current step:");
		expect(laneRunnerSrc).toContain("Iteration:");
		expect(laneRunnerSrc).toContain("No-progress count:");
	});

	it("2.7: supervisor reply polling has 60s timeout", () => {
		expect(laneRunnerSrc).toContain("SUPERVISOR_REPLY_TIMEOUT_MS = 60_000");
	});

	it("2.8: supervisor reply polling uses 2s interval", () => {
		expect(laneRunnerSrc).toContain("POLL_INTERVAL_MS = 2_000");
	});

	it("2.9: only accepts messages newer than escalation timestamp", () => {
		expect(laneRunnerSrc).toContain("escalationTimestamp");
		expect(laneRunnerSrc).toContain("message.timestamp >= escalationTimestamp");
	});

	it("2.10: only accepts messages from supervisor", () => {
		expect(laneRunnerSrc).toContain('message.from === "supervisor"');
	});

	it("2.11: close directives cause session to close normally", () => {
		const closeIdx = laneRunnerSrc.indexOf("CLOSE_DIRECTIVES");
		const closeBlock = laneRunnerSrc.slice(closeIdx, closeIdx + 800);
		expect(closeBlock).toContain('"skip"');
		expect(closeBlock).toContain('"let it fail"');
		expect(closeBlock).toContain('"close"');
		expect(closeBlock).toContain('"abort"');
		expect(closeBlock).toContain('"stop"');
		expect(closeBlock).toContain("return null");
	});

	it("2.12: instructional replies are returned as new prompt", () => {
		expect(laneRunnerSrc).toContain("return supervisorReply");
	});

	it("2.13: timeout fallback logs execution and returns null", () => {
		expect(laneRunnerSrc).toContain("Exit intercept timeout");
		expect(laneRunnerSrc).toContain("closing session");
	});

	it("2.14: imports readInbox and ackMessage from mailbox", () => {
		expect(laneRunnerSrc).toContain("readInbox,");
		expect(laneRunnerSrc).toContain("ackMessage,");
		expect(laneRunnerSrc).toContain("sessionInboxDir,");
	});
});

// ── 3. Supervisor alert category and types ──────────────────────────

describe("3.x: Supervisor alert types (TP-172)", () => {
	it("3.1: worker-exit-intercept is a valid SupervisorAlertCategory", () => {
		expect(typesSrc).toContain('"worker-exit-intercept"');
	});

	it("3.2: SupervisorAlertCategory includes worker-exit-intercept", () => {
		// Extract the type definition
		const start = typesSrc.indexOf("export type SupervisorAlertCategory =");
		const end = typesSrc.indexOf(";", start);
		const typeDef = typesSrc.slice(start, end);
		expect(typeDef).toContain('"worker-exit-intercept"');
	});
});

// ── 4. Supervisor primer documentation ──────────────────────────────

describe("4.x: Supervisor primer guidance (TP-172)", () => {
	it("4.1: primer includes worker-exit-intercept alert category", () => {
		expect(supervisorPrimerSrc).toContain("worker-exit-intercept");
	});

	it("4.2: primer includes Section 13c for exit interception", () => {
		expect(supervisorPrimerSrc).toContain("## 13c. Worker Exit Interception (TP-172)");
	});

	it("4.3: primer explains response protocol", () => {
		expect(supervisorPrimerSrc).toContain("send_agent_message");
		expect(supervisorPrimerSrc).toContain("skip");
		expect(supervisorPrimerSrc).toContain("let it fail");
	});

	it("4.4: primer explains interception limits", () => {
		expect(supervisorPrimerSrc).toContain("maxExitInterceptions");
		expect(supervisorPrimerSrc).toContain("at most **2 times**");
	});

	it("4.5: primer includes worker-exit-intercept in recovery matrix", () => {
		// Check that the recovery action matrix includes the new category
		expect(supervisorPrimerSrc).toContain("| worker-exit-intercept |");
	});

	it("4.6: primer includes worker-exit-intercept in alert categories table", () => {
		expect(supervisorPrimerSrc).toContain("| `worker-exit-intercept` | 🔄 |");
	});
});

// ── 5. End-to-end flow contracts ────────────────────────────────────

describe("5.x: End-to-end interception flow contracts (TP-172)", () => {
	it("5.1: agent-host tracks exit interception counter", () => {
		expect(agentHostSrc).toContain("exitInterceptionCount = 0");
		expect(agentHostSrc).toContain("exitInterceptionCount++");
	});

	it("5.2: lane-runner composes alert with truncated assistant message (500 chars)", () => {
		expect(laneRunnerSrc).toContain("assistantMessage.slice(0, 500)");
	});

	it("5.3: lane-runner collects up to 5 unchecked items", () => {
		expect(laneRunnerSrc).toContain("uncheckedMatches.slice(0, 5)");
	});

	it("5.4: worker exits with progress are NOT intercepted", () => {
		// The callback returns null when progress is detected
		expect(laneRunnerSrc).toContain("midTotalChecked > prevTotalChecked");
		expect(laneRunnerSrc).toContain("Worker checked off checkboxes");
		expect(laneRunnerSrc).toContain("return null");
	});

	it("5.5: worker exits with blockers are NOT intercepted", () => {
		expect(laneRunnerSrc).toContain("Worker logged a blocker");
	});

	it("5.6: close directive parsing is resilient to punctuation", () => {
		// Should match directives followed by space, colon, period, dash
		// Also verify short-message guard exists to prevent false matches
		const closeBlock = laneRunnerSrc.slice(
			laneRunnerSrc.indexOf("CLOSE_DIRECTIVES"),
			laneRunnerSrc.indexOf("CLOSE_DIRECTIVES") + 800,
		);
		expect(closeBlock).toContain("isShortEnoughForDirective");
		expect(closeBlock).toContain('startsWith(d + ":")');
		expect(closeBlock).toContain('startsWith(d + " ")');
		expect(closeBlock).toContain('startsWith(d + ".")');
		expect(closeBlock).toContain('startsWith(d + " -")');
	});

	it("5.7: newPromptPreview included in reprompt telemetry", () => {
		expect(agentHostSrc).toContain("newPromptPreview:");
	});
});
