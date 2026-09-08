/**
 * Gate ratification — trusted operation wiring + finalize-gate binding (#627 Stage 2a).
 *
 * Step 2 (this file, part 1): source-based assertions that the `ratify_gate`
 * tool and `/orch-ratify` command are registered, that the ratifier role is
 * stamped by the issuing path (supervisor for the tool, operator for the command,
 * exactly one operator stamp site), and that the sequencing invariant is stated.
 *
 * Step 3 (part 2): behavioural finalize-gate tests using the real `executeTaskV2`
 * with `spawnAgent` mocked.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const EXTENSION_SRC = readFileSync(join(HERE, "..", "taskplane", "extension.ts"), "utf-8");

// ── Step 2: trusted ratify operation wiring ───────────────────────────

describe("ratify_gate / orch-ratify wiring", () => {
	it("registers the ratify_gate supervisor tool", () => {
		assert.match(EXTENSION_SRC, /name:\s*"ratify_gate"/);
	});

	it("registers the /orch-ratify operator command", () => {
		assert.match(EXTENSION_SRC, /registerCommand\("orch-ratify"/);
	});

	it("stamps the supervisor ratifier role at exactly one site (the tool)", () => {
		const matches = EXTENSION_SRC.match(/RATIFY-SUPERVISOR-STAMP/g) ?? [];
		assert.equal(matches.length, 1);
	});

	it("stamps the operator ratifier role at exactly one site (the command)", () => {
		const matches = EXTENSION_SRC.match(/RATIFY-OPERATOR-STAMP/g) ?? [];
		assert.equal(matches.length, 1, "operator ratifier must be stamped at exactly one site");
	});

	it("never reads the ratifier role from a tool/command parameter", () => {
		// The record's ratifier is built from the code-stamped `actor`, not params.
		assert.doesNotMatch(EXTENSION_SRC, /ratifier:\s*params\./);
	});

	it("states the ruling → fold → verification → ratify_gate → APPROVE → .DONE sequencing invariant", () => {
		assert.match(EXTENSION_SRC, /SEQUENCING INVARIANT/);
		assert.match(EXTENSION_SRC, /ratify_gate.*→.*\.DONE/s);
	});

	it("audits the ratification via logRecoveryAction with a gate_ratified action", () => {
		assert.match(EXTENSION_SRC, /action:\s*"gate_ratified"/);
		assert.match(EXTENSION_SRC, /classification:\s*"destructive"/);
	});

	it("writes the APPROVE review with an explicit APPROVE verdict and the ratification link", () => {
		assert.match(EXTENSION_SRC, /## Verdict: APPROVE/);
		assert.match(EXTENSION_SRC, /ratificationLinkLine\(record\.id\)/);
	});
});
