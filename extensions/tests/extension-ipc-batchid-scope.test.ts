/**
 * Regression guard for issue #559: `ReferenceError: batchState is not defined`
 * crashes the orchestrator parent on the first IPC frame from the engine-worker.
 *
 * Root cause: TP-187 (#538) introduced `ipcBatchIdMatches(incomingBatchId)` and
 * a pair of stderr-logging template literals inside the supervisor's IPC
 * handler closure that all referenced `batchState.batchId`. The closure does
 * NOT bind a `batchState` variable — only `orchBatchState` and `supervisorState`
 * are in scope there (declared at the same nesting level as `terminatedLanes` /
 * `terminatedAgents`). The crash fired the moment the engine-worker sent its
 * first `lane-terminated` or `lane-respawned` IPC, taking down EVERY batch.
 *
 * Sage post-mortem follow-up: the canonical replacement is
 * `orchBatchState.batchId`, NOT `supervisorState.batchId`. The latter is only
 * populated when the supervisor activates (a separate event triggered by
 * alerts/intercepts), so for batches where the supervisor never activates the
 * gate would never fire and the zombie-alert filter would be defeated.
 * `orchBatchState.batchId` is reliably populated via state-sync IPC from the
 * moment the engine-worker emits its first state-sync frame onward, making
 * it the correct binding for the live-batch comparison.
 *
 * The crash slipped through because:
 *   - `node --experimental-strip-types` does not perform name-resolution
 *     checks; it only strips type annotations, leaving runtime ReferenceErrors
 *     to surface at IPC time.
 *   - The TP-187 in-batch tests mock the IPC handlers at a different layer
 *     (`engine-worker → supervisor` callbacks via `executeOrchBatch`'s deps
 *     parameter), bypassing the actual extension closure under fault.
 *
 * This test asserts BOTH:
 *   1. The buggy identifier `batchState.batchId` does NOT appear inside the
 *      lexical region between `let supervisorState = freshSupervisorState()`
 *      and the close of the lane-terminated/lane-respawned handler block(s).
 *      Other regions of extension.ts legitimately bind a different `batchState`
 *      via destructuring (e.g., `const batchState = lockResult.batchState;`)
 *      and use it correctly — those are out of scope for this guard.
 *   2. The closure-scope IPC helpers reference `supervisorState.batchId`,
 *      which is the actually-in-scope binding.
 *
 * If a future edit reverts to `batchState.batchId` inside the supervisor IPC
 * closure, this test fails with a clear pointer at the regression.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(__dirname, "..", "taskplane", "extension.ts");
const source = readFileSync(extensionPath, "utf-8");

/**
 * Strip line- and block-comments from a TypeScript source string. We use this
 * to avoid false positives from documentation-of-the-bug comments that legally
 * contain the forbidden identifier (e.g., 'use `supervisorState.batchId`, not
 * `batchState.batchId`'). Only executable code is in scope for the regression
 * guard — not commentary about the regression.
 */
function stripComments(text: string): string {
	// Block comments first (greedy across lines), then line comments.
	const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
	return noBlock.replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Locate the lexical region of the supervisor's IPC handler closure. Anchored
 * by the canonical declaration `let supervisorState = freshSupervisorState();`
 * (line ~1680) at the start, and the second `// Activate supervisor agent`
 * comment (which marks the end of the resume-flow handler block, ~line 2710)
 * at the end. Anything between these markers belongs to the closure under
 * test — including BOTH copies of the lane-terminated / lane-respawned handler
 * pair (one for the execute flow, one for the resume flow).
 */
function locateSupervisorClosureRegion(): { start: number; end: number; body: string } {
	const startMarker = "let supervisorState = freshSupervisorState();";
	const startIdx = source.indexOf(startMarker);
	assert.ok(
		startIdx >= 0,
		`Could not locate '${startMarker}' anchor in extension.ts — did the closure declaration site move?`,
	);
	// Find the SECOND occurrence of "Activate supervisor agent" (resume flow).
	const activateMarker = "Activate supervisor agent";
	const firstActivate = source.indexOf(activateMarker, startIdx);
	assert.ok(firstActivate > startIdx, "Could not locate first 'Activate supervisor agent' anchor");
	const secondActivate = source.indexOf(activateMarker, firstActivate + activateMarker.length);
	assert.ok(secondActivate > firstActivate, "Could not locate second 'Activate supervisor agent' anchor");
	return {
		start: startIdx,
		end: secondActivate,
		body: source.slice(startIdx, secondActivate),
	};
}

describe("extension.ts supervisor IPC closure — batchId scope (regression #559)", () => {
	const region = locateSupervisorClosureRegion();
	const codeOnly = stripComments(region.body);

	it("references `orchBatchState.batchId` for the live-batch check (sage post-mortem)", () => {
		// `orchBatchState` is the let-binding the extension manages itself
		// (declared on extension.ts:1669 just above `supervisorState`). It's
		// populated reliably via state-sync IPC. `supervisorState.batchId`
		// would also be in scope, but it stays `""` for batches where the
		// supervisor never activates — using it would defeat the gate.
		assert.ok(
			codeOnly.includes("orchBatchState.batchId"),
			"Expected at least one reference to `orchBatchState.batchId` inside the supervisor IPC closure. " +
			"That's the canonical live-batch identifier in scope. If the only batchId reference is via " +
			"`supervisorState.batchId`, the gate effectively never fires (sage post-mortem on #559).",
		);
	});

	it("contains the canonical `ipcBatchIdMatches` helper", () => {
		assert.ok(
			region.body.includes("const ipcBatchIdMatches"),
			"Expected `const ipcBatchIdMatches = ...` inside the supervisor IPC closure",
		);
	});

	it("does NOT reference `batchState.batchId` anywhere in the closure (would crash on first IPC)", () => {
		// The closure does not bind a `batchState` variable. The previous bug
		// referenced `batchState.batchId` in five places:
		//   1. `const currentBatchId = batchState.batchId;` inside `ipcBatchIdMatches`
		//   2-3. Two stderr templates `${batchState.batchId}` in the execute-flow
		//        lane-terminated / lane-respawned handlers
		//   4-5. Two stderr templates `${batchState.batchId}` in the resume-flow
		//        copies of those handlers
		// Any of the five threw `ReferenceError: batchState is not defined`
		// when the matching IPC fired, crashing the parent process.
		const occurrences = codeOnly.match(/\bbatchState\.batchId\b/g) ?? [];
		assert.strictEqual(
			occurrences.length,
			0,
			`Found ${occurrences.length} occurrence(s) of \`batchState.batchId\` inside the ` +
			`supervisor IPC closure (lines ${region.start}-${region.end}). \`batchState\` is NOT ` +
			`bound in this scope — only \`supervisorState\` is. References to \`batchState.batchId\` ` +
			`crash the orchestrator parent with ReferenceError on the first IPC frame (issue #559). ` +
			`Use \`supervisorState.batchId\` instead.`,
		);
	});

	it("`ipcBatchIdMatches` body specifically uses `orchBatchState.batchId`", () => {
		// Tightest assertion: the helper body itself is using the correct binding.
		const helperStart = codeOnly.indexOf("const ipcBatchIdMatches");
		assert.ok(helperStart >= 0, "Could not locate `ipcBatchIdMatches` declaration");
		// Body extends to the next `};` which closes the arrow function.
		const helperEnd = codeOnly.indexOf("};", helperStart);
		assert.ok(helperEnd > helperStart, "Could not locate end of `ipcBatchIdMatches` declaration");
		const helperBody = codeOnly.slice(helperStart, helperEnd);
		assert.ok(
			helperBody.includes("orchBatchState.batchId"),
			"`ipcBatchIdMatches` must read the current batch ID from `orchBatchState.batchId` " +
			"(the let-binding the extension manages itself, populated via state-sync IPC). " +
			"Reading from `supervisorState.batchId` would defeat the gate for non-supervised batches.",
		);
		assert.ok(
			!helperBody.includes("batchState.batchId"),
			"`ipcBatchIdMatches` must NOT reference `batchState.batchId` — that's the #559 crash",
		);
	});
});
