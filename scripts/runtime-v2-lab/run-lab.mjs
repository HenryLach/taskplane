import { spawn, spawnSync } from "child_process";
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	renameSync,
	existsSync,
	rmSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";

function wait(ms) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function ensureDir(dir) {
	mkdirSync(dir, { recursive: true });
	return dir;
}

function resolvePiCliPath() {
	const appData = process.env.APPDATA;
	if (!appData) throw new Error("APPDATA is not set; cannot resolve pi CLI path.");
	return join(appData, "npm", "node_modules", "@mariozechner", "pi-coding-agent", "dist", "cli.js");
}

function resolvePiVersion() {
	try {
		const result = spawnSync(process.execPath, [resolvePiCliPath(), "--version"], {
			encoding: "utf8",
			shell: false,
			timeout: 10_000,
		});
		return result.stdout?.trim() || null;
	} catch {
		return null;
	}
}

function contentToText(message) {
	if (!message || !Array.isArray(message.content)) return "";
	return message.content
		.map((part) => {
			if (part && typeof part === "object" && typeof part.text === "string") return part.text;
			return "";
		})
		.join(" ")
		.trim();
}

function writeMailboxMessage(mailboxDir, batchId, to, content) {
	const inboxDir = ensureDir(join(mailboxDir, "inbox"));
	const id = `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
	const message = {
		id,
		batchId,
		from: "supervisor",
		to,
		timestamp: Date.now(),
		type: "steer",
		content,
	};
	const tempPath = join(inboxDir, `${id}.msg.json.tmp`);
	const finalPath = join(inboxDir, `${id}.msg.json`);
	writeFileSync(tempPath, JSON.stringify(message) + "\n", "utf8");
	renameSync(tempPath, finalPath);
	return { id, finalPath };
}

function readJsonFile(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

async function runPiAgent(options) {
	const {
		prompt,
		systemPrompt,
		tools,
		cwd,
		closeDelayMs = 100,
		requestSessionStats = true,
		timeoutMs = 45_000,
		mailboxDir = null,
	} = options;

	const cliPath = resolvePiCliPath();
	const args = [cliPath, "--mode", "rpc", "--no-session", "--no-extensions", "--no-skills"];
	if (tools && tools.length > 0) {
		args.push("--tools", tools.join(","));
	}
	if (systemPrompt) {
		args.push("--system-prompt", systemPrompt);
	}

	return await new Promise((resolvePromise) => {
		const proc = spawn(process.execPath, args, {
			shell: false,
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		let stdoutBuffer = "";
		let stderrBuffer = "";
		let statsRequested = false;
		let agentEnded = false;
		let finished = false;
		const startedAt = Date.now();
		const eventTypes = [];
		const messages = [];
		const toolCalls = [];
		const deliveredMessages = [];
		let contextUsage = null;
		let statsResponse = null;

		const timeoutHandle = setTimeout(() => {
			try {
				proc.kill("SIGTERM");
			} catch {
				// Ignore kill failures on timeout path.
			}
		}, timeoutMs);

		function finish(result) {
			if (finished) return;
			finished = true;
			clearTimeout(timeoutHandle);
			resolvePromise({
				...result,
				durationMs: Date.now() - startedAt,
				stderr: stderrBuffer,
				eventTypes,
				messages,
				toolCalls,
				deliveredMessages,
				contextUsage,
				statsResponse,
			});
		}

		function maybeDeliverMailbox() {
			if (!mailboxDir) return;
			const inboxDir = join(mailboxDir, "inbox");
			if (!existsSync(inboxDir)) return;
			const ackDir = ensureDir(join(mailboxDir, "ack"));
			const files = readdirSync(inboxDir)
				.filter((name) => name.endsWith(".msg.json"))
				.sort();
			for (const name of files) {
				const sourcePath = join(inboxDir, name);
				const message = readJsonFile(sourcePath);
				proc.stdin.write(JSON.stringify({ type: "steer", message: message.content }) + "\n");
				renameSync(sourcePath, join(ackDir, name));
				deliveredMessages.push(message.id);
			}
		}

		proc.stdout.setEncoding("utf8");
		proc.stderr.setEncoding("utf8");

		proc.stdout.on("data", (chunk) => {
			stdoutBuffer += chunk;
			let newlineIndex = stdoutBuffer.indexOf("\n");
			while (newlineIndex >= 0) {
				const line = stdoutBuffer.slice(0, newlineIndex);
				stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
				newlineIndex = stdoutBuffer.indexOf("\n");
				if (!line.trim()) continue;
				let event;
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}
				eventTypes.push(event.type || "unknown");
				if (event.type === "tool_execution_start") {
					toolCalls.push(event.toolName || event.tool?.name || "tool");
				}
				if (event.type === "message_end") {
					messages.push({
						role: event.message?.role || "unknown",
						text: contentToText(event.message),
						stopReason: event.message?.stopReason || null,
						error: event.message?.errorMessage || null,
					});
					maybeDeliverMailbox();
					if (
						requestSessionStats &&
						!statsRequested &&
						event.message?.role === "assistant"
					) {
						statsRequested = true;
						proc.stdin.write(JSON.stringify({ type: "get_session_stats" }) + "\n");
					}
				}
				if (event.type === "response" && event.command === "get_session_stats") {
					statsResponse = event.data || null;
					contextUsage = event.data?.contextUsage || null;
				}
				if (event.type === "agent_end" && !agentEnded) {
					agentEnded = true;
					if (closeDelayMs <= 0) {
						try {
							proc.stdin.end();
						} catch {
							// Ignore stdin close failures.
						}
					} else {
						setTimeout(() => {
							try {
								proc.stdin.end();
							} catch {
								// Ignore stdin close failures.
							}
						}, closeDelayMs);
					}
				}
			}
		});

		proc.stderr.on("data", (chunk) => {
			stderrBuffer += chunk;
		});

		proc.on("error", (error) => {
			finish({ exitCode: null, signal: null, error: `spawn error: ${error.message}` });
		});

		proc.on("close", (code, signal) => {
			finish({ exitCode: code, signal, error: null });
		});

		if (mailboxDir) {
			proc.stdin.write(JSON.stringify({ type: "set_steering_mode", mode: "all" }) + "\n");
		}
		proc.stdin.write(JSON.stringify({ type: "prompt", message: prompt }) + "\n");
	});
}

async function experimentCloseStrategies() {
	const prompt = "Reply with exactly OK and then stop.";
	const immediate = await runPiAgent({ prompt, closeDelayMs: 0, requestSessionStats: false, timeoutMs: 20_000 });
	const delayed = await runPiAgent({ prompt, closeDelayMs: 100, requestSessionStats: true, timeoutMs: 20_000 });
	return {
		name: "close-strategy",
		immediate: {
			exitCode: immediate.exitCode,
			stderrTail: immediate.stderr.trim().slice(-160),
			hasAssertion: immediate.stderr.includes("Assertion failed"),
		},
		delayed: {
			exitCode: delayed.exitCode,
			contextUsagePresent: !!delayed.contextUsage,
			assistantTexts: delayed.messages.filter((m) => m.role === "assistant").map((m) => m.text),
		},
	};
}

async function experimentSequentialParallelReliability() {
	const prompt = "Reply with exactly OK and then stop.";
	const sequentialRuns = [];
	for (let i = 0; i < 5; i++) {
		const result = await runPiAgent({ prompt, closeDelayMs: 100, requestSessionStats: true, timeoutMs: 20_000 });
		sequentialRuns.push({ exitCode: result.exitCode, contextUsagePresent: !!result.contextUsage, stderrTail: result.stderr.trim().slice(-120) });
	}
	const parallel = await Promise.all(
		[1, 2, 3].map(() => runPiAgent({ prompt, closeDelayMs: 100, requestSessionStats: true, timeoutMs: 20_000 })),
	);
	return {
		name: "reliability",
		sequential: {
			runs: sequentialRuns.length,
			successes: sequentialRuns.filter((r) => r.exitCode === 0 && r.contextUsagePresent).length,
			results: sequentialRuns,
		},
		parallel: {
			runs: parallel.length,
			successes: parallel.filter((r) => r.exitCode === 0 && r.contextUsage).length,
			results: parallel.map((r) => ({ exitCode: r.exitCode, contextUsagePresent: !!r.contextUsage, stderrTail: r.stderr.trim().slice(-120) })),
		},
	};
}

async function experimentMailboxSteering() {
	const tempRoot = mkdtempSync(join(tmpdir(), "tp-runtime-v2-mailbox-"));
	const batchId = "lab-batch";
	const agentId = "lab-agent";
	const mailboxDir = ensureDir(join(tempRoot, ".pi", "mailbox", batchId, agentId));
	const message = writeMailboxMessage(mailboxDir, batchId, agentId, "Reply with exactly STEER-ACK and then stop.");
	const prompt = "First reply with exactly READY. If you later receive a steering message, follow it exactly and then stop.";
	const result = await runPiAgent({
		prompt,
		mailboxDir,
		closeDelayMs: 100,
		requestSessionStats: true,
		timeoutMs: 30_000,
	});
	const ackDir = join(mailboxDir, "ack");
	const acked = existsSync(ackDir) ? readdirSync(ackDir) : [];
	rmSync(tempRoot, { recursive: true, force: true });
	return {
		name: "mailbox-steering",
		exitCode: result.exitCode,
		deliveredMessages: result.deliveredMessages,
		ackFiles: acked,
		assistantTexts: result.messages.filter((m) => m.role === "assistant").map((m) => m.text),
		prewrittenMessageId: message.id,
	};
}

async function experimentPacketPaths() {
	async function runPacketAttempt() {
		const tempRoot = mkdtempSync(join(tmpdir(), "tp-runtime-v2-packet-"));
		const executionDir = ensureDir(join(tempRoot, "execution-repo"));
		const packetHomeDir = ensureDir(join(tempRoot, "packet-home"));
		const promptPath = join(packetHomeDir, "PROMPT.md");
		const statusPath = join(packetHomeDir, "STATUS.md");
		const donePath = join(packetHomeDir, ".DONE");
		writeFileSync(promptPath, "# packet prompt\nDo the thing\n", "utf8");
		writeFileSync(statusPath, "# status\nNot done\n", "utf8");
		const prompt = `Your cwd is ${executionDir}. The packet home is different. Read these files: ${promptPath} and ${statusPath}. After reading them, write the exact text \"packet done\\n\" to ${donePath}. Then respond with exactly PACKET-OK and stop.`;
		const result = await runPiAgent({
			prompt,
			tools: ["read", "write"],
			cwd: executionDir,
			closeDelayMs: 100,
			requestSessionStats: true,
			timeoutMs: 60_000,
		});
		const summary = {
			exitCode: result.exitCode,
			signal: result.signal,
			doneExists: existsSync(donePath),
			doneContent: existsSync(donePath) ? readFileSync(donePath, "utf8") : null,
			toolCalls: result.toolCalls,
			assistantTexts: result.messages.filter((m) => m.role === "assistant").map((m) => m.text),
			stderrTail: result.stderr.trim().slice(-120),
		};
		rmSync(tempRoot, { recursive: true, force: true });
		return summary;
	}

	const attempts = [];
	attempts.push(await runPacketAttempt());
	attempts.push(await runPacketAttempt());
	return {
		name: "packet-paths",
		attempts,
		successes: attempts.filter((attempt) => attempt.exitCode === 0 && attempt.doneExists).length,
		note: "A passing attempt demonstrates explicit packet paths are viable outside cwd assumptions; a failing/hanging attempt indicates tool-heavy multi-step prompts still need robust retry/timeout handling in Runtime V2.",
	};
}

async function experimentBridgeFeasibility() {
	const prompt = "Reply with exactly BRIDGE-DEFERRED and then stop.";
	const result = await runPiAgent({ prompt, closeDelayMs: 100, requestSessionStats: true, timeoutMs: 20_000 });
	return {
		name: "bridge-feasibility",
		status: "open",
		note: "A true synchronous file-bridge callback was not validated in this first lab run. The mailbox and packet-path experiments reduce risk, but bridge semantics still need a dedicated proof task during TP-106/TP-105 work.",
		smokeExitCode: result.exitCode,
		smokeAssistantTexts: result.messages.filter((m) => m.role === "assistant").map((m) => m.text),
	};
}

async function main() {
	const summary = {
		runAt: new Date().toISOString(),
		environment: {
			node: process.version,
			piVersion: resolvePiVersion(),
			sessionModeBaseline: "session-attached but resumable",
		},
		experiments: [],
	};

	summary.experiments.push(await experimentCloseStrategies());
	summary.experiments.push(await experimentSequentialParallelReliability());
	summary.experiments.push(await experimentMailboxSteering());
	summary.experiments.push(await experimentPacketPaths());
	summary.experiments.push(await experimentBridgeFeasibility());

	const outDir = ensureDir(resolve("scripts", "runtime-v2-lab", "out"));
	const summaryPath = join(outDir, "latest-summary.json");
	writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
	console.log(`Wrote ${summaryPath}`);
	console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
