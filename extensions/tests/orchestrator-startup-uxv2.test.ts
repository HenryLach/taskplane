/**
 * Orchestrator startup UX (TP-183 / GitHub #523)
 *
 * Verifies the soft-fail UX in `extension.ts` `session_start`:
 *
 *   - `WORKSPACE_SETUP_REQUIRED` (no workspace config AND cwd is not a git
 *     repo) MUST NOT call `ctx.ui.notify(..., "error")`. The status line is
 *     quiet (no ❌ icon) and includes the phrase "no taskplane config".
 *     Orchestrator commands stay gracefully disabled because `execCtx`
 *     remains null and `execCtxInitError` is populated for command guards.
 *
 *   - Every other `WorkspaceConfigErrorCode` (malformed workspace YAML,
 *     missing repos, schema invalid, etc.) MUST keep calling the loud
 *     `ctx.ui.notify(..., "error")` and the loud status line so real
 *     misconfigurations stay visible.
 *
 *   - Successful config load (no exception) MUST NOT trigger any of the
 *     error branches above.
 *
 * Approach: source-pattern checks against `extension.ts`, matching the
 * established model in `workspace-config.integration.test.ts` (suite 5.x).
 * The repo intentionally has no fake-`pi` infrastructure for invoking
 * `pi.on("session_start")` handlers in unit tests, and refactoring
 * `extension.ts` to expose a unit-testable helper would expand the scope of
 * this UX tweak. Source patterns reliably encode the catch-block branch
 * structure, which is exactly what TP-183 changes.
 *
 * Run:
 *   node --experimental-strip-types --experimental-test-module-mocks \
 *     --no-warnings --import ./tests/loader.mjs \
 *     --test tests/orchestrator-startup-uxv2.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionSrc = readFileSync(resolve(__dirname, "..", "taskplane", "extension.ts"), "utf-8");

/**
 * Extract the body of the `WorkspaceConfigError` catch branch in the
 * `session_start` handler. We slice from the `pi.on("session_start"` anchor
 * to the matching closing brace of the `if (err instanceof
 * WorkspaceConfigError)` block. This is the only block TP-183 touches.
 */
function extractSessionStartCatchBlock(src: string): string {
	const sessionStartIdx = src.indexOf('pi.on("session_start"');
	expect(sessionStartIdx).toBeGreaterThan(-1);

	const catchIdx = src.indexOf("err instanceof WorkspaceConfigError", sessionStartIdx);
	expect(catchIdx).toBeGreaterThan(-1);

	// Slice forward enough lines to capture the whole if-branch (~80 lines is
	// plenty given the current implementation's size).
	const tail = src.slice(catchIdx, catchIdx + 4000);
	// Cut at the next `throw err` line which terminates the WorkspaceConfigError branch.
	const throwIdx = tail.indexOf("throw err;");
	expect(throwIdx).toBeGreaterThan(-1);
	return tail.slice(0, throwIdx);
}

describe("orchestrator startup UX — soft-fail for WORKSPACE_SETUP_REQUIRED (TP-183)", () => {
	const block = extractSessionStartCatchBlock(extensionSrc);

	it("scenario 1: WORKSPACE_SETUP_REQUIRED branch suppresses the error notify", () => {
		// The setupError branch must not call `ctx.ui.notify(..., "error")`.
		// We verify the branch structure: there is a `setupError` boolean, and
		// the `if (setupError) { ... } else { ... }` arms separate quiet from
		// loud display. The quiet arm runs `setStatus` only; the loud arm
		// runs both `notify` and `setStatus`.
		expect(block).toContain('err.code === "WORKSPACE_SETUP_REQUIRED"');
		expect(block).toContain("if (setupError)");

		// Find the quiet arm body (between `if (setupError) {` and the matching
		// `} else {`). It must NOT call `ctx.ui.notify`.
		const ifIdx = block.indexOf("if (setupError) {");
		expect(ifIdx).toBeGreaterThan(-1);
		const elseIdx = block.indexOf("} else {", ifIdx);
		expect(elseIdx).toBeGreaterThan(ifIdx);
		const quietArm = block.slice(ifIdx, elseIdx);
		expect(quietArm).not.toContain("ctx.ui.notify");
		// And it must set a status line.
		expect(quietArm).toContain("ctx.ui.setStatus");
	});

	it("scenario 1: WORKSPACE_SETUP_REQUIRED status line is the quiet variant (no ❌ icon, mentions config)", () => {
		const ifIdx = block.indexOf("if (setupError) {");
		const elseIdx = block.indexOf("} else {", ifIdx);
		const quietArm = block.slice(ifIdx, elseIdx);

		// The quiet status line must not contain the loud-failure red-X marker.
		expect(quietArm).not.toContain("❌ startup failed");
		// And it must say "disabled" / mention the missing taskplane config so
		// the user has a clear, non-alarming explanation.
		expect(quietArm).toContain("disabled");
		expect(quietArm.toLowerCase()).toContain("taskplane");
	});

	it("scenario 1: orchestrator commands stay gracefully disabled (execCtxInitError still populated)", () => {
		// `execCtxInitError` must still be set in the setup case so that
		// `requireExecCtx` / `getExecCtxInitErrorMessage` can give the user a
		// clear error if they actually invoke an /orch command. The quiet UX
		// suppresses the *display* at startup, not the error itself.
		expect(block).toContain("execCtxInitError = setupError");
		// The setup-case message must still describe the situation.
		expect(block).toContain("Orchestrator startup blocked");
		// And `execCtx` is never assigned in this catch — the early `return`
		// after `setStatus` leaves it `null`, which is what every command
		// guard short-circuits on.
		expect(block).toContain("return;");
	});

	it("scenario 2: WORKSPACE_CONFIG_INVALID (and other codes) keep the loud notify (regression guard)", () => {
		// The non-setupError arm must still call `ctx.ui.notify(..., "error")`
		// AND set the loud status line. This branch covers every code other
		// than WORKSPACE_SETUP_REQUIRED — including WORKSPACE_FILE_PARSE_ERROR,
		// WORKSPACE_SCHEMA_INVALID, WORKSPACE_REPO_PATH_NOT_FOUND, etc.
		const ifIdx = block.indexOf("if (setupError) {");
		const elseIdx = block.indexOf("} else {", ifIdx);
		expect(elseIdx).toBeGreaterThan(ifIdx);
		// Find end of the else arm (matching close brace). We rely on the
		// `return;` terminator inside the if/else to bound the slice.
		const afterElse = block.slice(elseIdx);
		const returnIdx = afterElse.indexOf("return;");
		expect(returnIdx).toBeGreaterThan(-1);
		const loudArm = afterElse.slice(0, returnIdx);

		expect(loudArm).toContain('ctx.ui.notify(execCtxInitError, "error")');
		expect(loudArm).toContain("❌ startup failed (workspace config error)");
	});

	it("scenario 2: the loud-arm message keeps the existing 'Workspace configuration error' wording", () => {
		// Regression guard for the user-visible string in the non-setup case.
		// If this changes intentionally, update the docs / changelog too.
		expect(block).toContain("Workspace configuration error");
		expect(block).toContain("Fix the workspace config");
	});

	it("global guard: the catch block calls notify(error) exactly once, and only in the loud arm (sage code review TP-183)", () => {
		// Stronger guarantee than the per-arm assertions above: across the
		// ENTIRE WorkspaceConfigError catch block, the error-severity notify
		// call must appear exactly once, and that one occurrence must be inside
		// the loud (non-setupError) arm. This catches subtle regressions where
		// a future edit might add a notify ABOVE the setupError switch (which
		// would re-introduce the loud path for the soft-fail case while still
		// passing the per-arm assertions because each slice is checked
		// independently).
		const notifyErrorMatches = block.match(/ctx\.ui\.notify\(execCtxInitError, "error"\)/g) ?? [];
		expect(notifyErrorMatches.length).toBe(1);

		// Verify the single occurrence is positioned AFTER the `} else {`
		// (i.e. inside the loud arm), not before the `if (setupError)` or
		// inside the quiet arm.
		const notifyIdx = block.indexOf('ctx.ui.notify(execCtxInitError, "error")');
		const elseIdx = block.indexOf("} else {");
		expect(notifyIdx).toBeGreaterThan(elseIdx);
	});

	it("scenario 3: successful buildExecutionContext skips the entire WorkspaceConfigError arm", () => {
		// Sanity baseline: the catch arm only fires when buildExecutionContext
		// throws. The success path (no throw) flows past the catch into the
		// rest of session_start. We verify by checking that the success-path
		// `orchConfig = execCtx.orchestratorConfig` line is OUTSIDE the catch.
		const tryIdx = extensionSrc.indexOf("execCtx = buildExecutionContext(");
		expect(tryIdx).toBeGreaterThan(-1);
		const successIdx = extensionSrc.indexOf("orchConfig = execCtx.orchestratorConfig", tryIdx);
		expect(successIdx).toBeGreaterThan(tryIdx);
		// And the success path is reached only by NOT entering the catch arm:
		// the catch arm always ends with `return;` (setupError) or `return;` /
		// `throw err;` (other), so the success line is not reachable from
		// inside the catch.
		const between = extensionSrc.slice(tryIdx, successIdx);
		expect(between).toContain("} catch (err: unknown) {");
		expect(between).toContain("throw err;"); // unexpected-error rethrow
	});
});
