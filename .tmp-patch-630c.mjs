import { readFileSync, writeFileSync } from "node:fs";
const f = "extensions/tests/issue-630-hold-exit.test.ts";
let s = readFileSync(f, "utf8");
function rep(a, b) {
	const n = s.split(a).length - 1;
	if (n !== 1) {
		console.error("anchor", n, ":", a.slice(0, 80));
		process.exit(1);
	}
	s = s.replace(a, b);
}
rep(
	`let onSpawn: ((index: number, opts: { mailboxDir?: string; steeringPendingPath?: string | null }) => void) | null =\n\tnull;`,
	`let onSpawn: ((index: number, opts: { mailboxDir?: string; steeringPendingPath?: string | null }) => void) | null =\n\tnull;\n/** Optional async hook run by the mock worker BEFORE it "exits" (drives onPrematureExit). */\nlet beforeExit:\n\t| ((index: number, opts: { onPrematureExit?: (m: string) => Promise<string | null> }) => Promise<void>)\n\t| null = null;`,
);
rep(
	`\treturn { promise: Promise.resolve(result), kill: () => {} } as unknown as ReturnType<\n\t\ttypeof realAgentHost.spawnAgent\n\t>;\n});\nmock.module(`,
	`\tconst promise = (async () => {\n\t\tif (beforeExit) await beforeExit(index, opts as never);\n\t\treturn result;\n\t})();\n\treturn { promise, kill: () => {} } as unknown as ReturnType<typeof realAgentHost.spawnAgent>;\n});\nmock.module(`,
);
const start = s.indexOf(`\tit("BLOCKER 1: a ruling consumed by the exit-intercept path releases the hold", async () => {`);
const end = s.indexOf(`\tit("BLOCKER 2:`, start);
if (start < 0 || end < 0) {
	console.error("b1 markers", start, end);
	process.exit(1);
}
const b1 = `\tit("BLOCKER 1: a ruling consumed by the exit-intercept path releases the hold", async () => {
		const { writeMailboxMessage } = await import("../taskplane/mailbox.ts");
		onSpawn = (i) => {
			if (i === 0) {
				writeOutboxMessage(tmpRoot, BATCH, AGENT, {
					from: AGENT,
					type: "escalate",
					content: "Need a ruling.",
					expectsReply: true,
				});
			}
		};
		// Spawn 1 (hold-resume relaunch): the worker "tries to exit"; agent-host calls
		// onPrematureExit, which polls the INBOX (not .steering-pending) and returns the
		// supervisor reply as the next prompt. Drive exactly that path.
		beforeExit = async (i, opts) => {
			if (i === 1 && opts.onPrematureExit) {
				setTimeout(() => {
					writeMailboxMessage(tmpRoot, BATCH, AGENT, {
						from: "supervisor",
						type: "steer",
						content: "Ruling: proceed with option A and re-run the review.",
					});
				}, 300);
				const reprompt = await opts.onPrematureExit("I am holding for a ruling.");
				expect(reprompt).toContain("Ruling: proceed with option A");
			}
		};
		const { unit, config } = buildUnitAndConfig(2);
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: false },
		);
		const status = readFileSync(join(taskFolder, "STATUS.md"), "utf-8");
		expect(status).toContain("Exit intercept reprompt");
		expect(spawnPrompts[1]).toContain("YOU ARE ON HOLD"); // relaunch 1 was a hold-resume
		// The hold was released by the intercept path: spawn 2 is a normal prompt and the
		// task ends via ordinary stall accounting, NOT 'Hold unresolved'.
		expect(spawnPrompts[2]).not.toContain("YOU ARE ON HOLD");
		expect(result.outcome.exitReason).not.toContain("Hold unresolved");
	});

`;
s = s.slice(0, start) + b1 + s.slice(end);
s = s
	.split(`\t\tspawnPrompts = [];\n\t\tonSpawn = null;\n\t\talerts = [];`)
	.join(`\t\tspawnPrompts = [];\n\t\tonSpawn = null;\n\t\tbeforeExit = null;\n\t\talerts = [];`);
writeFileSync(f, s);
console.log("ok");
