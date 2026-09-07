import { readFileSync, writeFileSync } from "node:fs";
function patch(f, pairs) { let s = readFileSync(f, "utf8"); for (const [a, b] of pairs) { const n = s.split(a).length - 1; if (n !== 1) { console.error("anchor", n, "in", f, ":", a.slice(0, 90)); process.exit(1); } s = s.replace(a, b); } writeFileSync(f, s); console.log("patched", f); }
patch("extensions/tests/exit-interception.test.ts", [
	[`		expect(agentHostSrc).toContain("INTERCEPTION_TIMEOUT_MS = 120_000");`,
	 `		// Configurable safety race (defaults to 120s; lane passes window + 60s).
		expect(agentHostSrc).toContain("INTERCEPTION_TIMEOUT_MS = opts.exitInterceptSafetyMs ?? 120_000");`],
	[`		expect(laneRunnerSrc).toContain("SUPERVISOR_REPLY_TIMEOUT_MS = 60_000");`,
	 `		// Window is configurable (taskRunner.worker.exitInterceptTimeoutSec; default 60s, 15..1800).
		expect(laneRunnerSrc.replace(/\s+/g, " ")).toContain(
			"SUPERVISOR_REPLY_TIMEOUT_MS = Math.min(1800, Math.max(15, config.exitInterceptTimeoutSec ?? 60)) * 1000;",
		);`],
]);
patch("extensions/tests/issue-629-retry-segment-reset.test.ts", [[
	`		expect(occurrences).toBe(4); // definition + finalize + pre-spawn + post-iteration re-check`,
	`		expect(occurrences).toBe(5); // definition + finalize + pre-spawn + post-iteration re-check + step-completion gate`]]);
patch("docs/reference/configuration/task-runner.yaml.md", [[
	"| `worker.spawn_mode` | `\"subprocess\"` \| `\"tmux\"` | commented in template | Optional spawn mode override for task-runner. |\n",
	"| `worker.spawn_mode` | `\"subprocess\"` \| `\"tmux\"` | commented in template | Optional spawn mode override for task-runner. |\n| `worker.exit_intercept_timeout_sec` | number | `60` (15..1800) | How long the lane waits for a supervisor reply when it intercepts a worker's premature exit before letting the session close. Raise it when the supervisor is often inside long tool calls (a blocking `--wait` cannot answer in 60 s). |\n"]]);
