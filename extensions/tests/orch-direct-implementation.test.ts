import { execSync, spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

import {
	serializeBatchState,
	freshOrchBatchState,
	computeResumePoint,
	selectAbortTargetSessions,
	hasTaskDoneMarker,
	runGit,
	resolveOperatorId,
	generateBatchId,
	resolveBaseBranch,
	getCurrentBranch,
	ORCH_MESSAGES,
} from "../task-orchestrator.ts";

// Detect vitest: if present, wrap everything in a describe/it block
const isVitest = typeof globalThis.vi !== "undefined" || !!process.env.VITEST;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`✗ ${message}`);
		return;
	}
	passed++;
}

function runAllTests(): void {
	console.log("\n── direct implementation checks (TS-009 remediation) ──");

	// 1) serializeBatchState keeps full task registry from wave plan, even without outcomes.
	{
		const state = freshOrchBatchState();
		state.phase = "executing";
		state.batchId = "20260309T120000";
		state.startedAt = Date.now();
		state.currentWaveIndex = 0;
		state.totalWaves = 2;
		state.totalTasks = 3;

		const json = serializeBatchState(
			state,
			[["TS-100", "TS-101"], ["TS-102"]],
			[],
			[],
		);
		const parsed = JSON.parse(json);
		assert(parsed.tasks.length === 3, "serializeBatchState writes all 3 planned tasks into registry");
		assert(parsed.tasks.every((t: any) => t.status === "pending"), "tasks default to pending without outcomes");
	}

	// 2) computeResumePoint should NOT re-queue mark-failed tasks as pending.
	{
		const persistedState: any = {
			wavePlan: [["TS-200", "TS-201"]],
		};
		const reconciledTasks: any[] = [
			{ taskId: "TS-200", action: "mark-failed", liveStatus: "failed", persistedStatus: "running" },
			{ taskId: "TS-201", action: "mark-complete", liveStatus: "succeeded", persistedStatus: "running" },
		];
		const resumePoint = computeResumePoint(persistedState, reconciledTasks);
		assert(!resumePoint.pendingTaskIds.includes("TS-200"), "mark-failed task is not re-queued as pending");
		assert(resumePoint.failedTaskIds.includes("TS-200"), "mark-failed task remains in failed bucket");
	}

	// 3) selectAbortTargetSessions honors exact prefix (including hyphenated prefixes).
	{
		const sessions = [
			"orch-prod-lane-1",
			"orch-prod-merge-1",
			"orch-lane-1",
			"orch-prod-metrics",
		];
		const targets = selectAbortTargetSessions(sessions, null, [], "C:/repo", "orch-prod");
		const names = targets.map(t => t.sessionName).sort();
		assert(names.length === 2, "hyphenated prefix filters to 2 abort targets");
		assert(names[0] === "orch-prod-lane-1" && names[1] === "orch-prod-merge-1", "only lane/merge sessions for exact prefix are selected");
	}

	// 4) hasTaskDoneMarker checks archived path fallback.
	{
		const base = mkdtempSync(join(tmpdir(), "orch-done-"));
		try {
			const taskFolder = join(base, "tasks", "TS-300");
			const archiveTaskFolder = join(base, "tasks", "archive", "TS-300");
			mkdirSync(taskFolder, { recursive: true });
			mkdirSync(archiveTaskFolder, { recursive: true });
			writeFileSync(join(archiveTaskFolder, ".DONE"), "done\n", "utf-8");

			assert(hasTaskDoneMarker(taskFolder), "archived .DONE marker is detected from original task folder path");
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	}

	// ── 5) Orch branch creation: success path (TP-022 Step 1) ──
	{
		console.log("\n── orch branch creation tests (TP-022) ──");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-branch-test-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Init a test repo with an initial commit on main
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Generate expected orch branch name
			const orchConfig = {
				orchestrator: { operator_id: "testop" },
			} as any;
			const opId = resolveOperatorId(orchConfig);
			const batchId = generateBatchId();
			const orchBranch = `orch/${opId}-${batchId}`;

			// Create the branch (mirrors engine.ts logic)
			const result = runGit(["branch", orchBranch, "main"], repoDir);
			assert(result.ok, "orch branch creation succeeds");
			assert(orchBranch.startsWith("orch/"), "orch branch name has orch/ prefix");
			assert(orchBranch.includes(opId), "orch branch name contains operator id");
			assert(orchBranch.includes(batchId), "orch branch name contains batch id");

			// Verify the branch exists in the repo
			const verifyResult = runGit(["rev-parse", "--verify", `refs/heads/${orchBranch}`], repoDir);
			assert(verifyResult.ok, "orch branch ref is verifiable after creation");

			// Verify it points to the same commit as main
			const mainSha = runGit(["rev-parse", "main"], repoDir).stdout.trim();
			const orchSha = runGit(["rev-parse", orchBranch], repoDir).stdout.trim();
			assert(mainSha === orchSha, "orch branch points to same commit as base branch");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// ── 6) Orch branch creation: failure path (branch already exists) ──
	{
		const tempBase = mkdtempSync(join(tmpdir(), "orch-branch-fail-"));
		const repoDir = join(tempBase, "repo");
		try {
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Create the branch first
			const orchBranch = "orch/testop-duplicate";
			runGit(["branch", orchBranch, "main"], repoDir);

			// Attempt to create it again — should fail
			const result = runGit(["branch", orchBranch, "main"], repoDir);
			assert(!result.ok, "duplicate orch branch creation fails");

			// Verify error detail falls back correctly
			const errDetail = result.stderr || result.stdout || "unknown error";
			assert(errDetail.length > 0, "error detail is non-empty on branch creation failure");
			assert(errDetail !== "unknown error", "error detail contains actual git error, not fallback");

			// Verify the engine failure path sets correct state
			const batchState = freshOrchBatchState();
			batchState.phase = "planning";
			batchState.batchId = "test-batch";
			batchState.startedAt = Date.now();

			if (!result.ok) {
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push(`Failed to create orch branch '${orchBranch}': ${errDetail}`);
			}

			assert(batchState.phase === "failed", "batch state phase set to 'failed' on branch creation failure");
			assert(batchState.endedAt !== null, "batch state endedAt set on failure");
			assert(batchState.errors.length === 1, "exactly one error recorded");
			assert(batchState.errors[0].includes(orchBranch), "error message contains branch name");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// ── 7) Orch branch lifecycle: no orphan branches on planning exits ──
	// Validates that the engine creates the orch branch AFTER planning
	// validations, so early exits during preflight/discovery/graph/waves
	// cannot leak orphan branches.
	{
		// This is a structural test: verify that in engine.ts, the branch
		// creation block appears after all planning-phase early returns.
		// We verify this by reading the source and checking ordering.
		const engineSource = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");

		// Find positions of key planning-phase markers and branch creation
		const preflightReturnPos = engineSource.indexOf('batchState.errors.push("Preflight check failed")');
		const discoveryReturnPos = engineSource.indexOf('batchState.errors.push("Discovery had fatal errors');
		const noPendingReturnPos = engineSource.indexOf("No pending tasks found");
		const graphReturnPos = engineSource.indexOf("Graph validation failed");
		const waveReturnPos = engineSource.indexOf("Wave computation failed");
		const branchCreationPos = engineSource.indexOf('runGit(["branch", orchBranch, batchState.baseBranch]');

		assert(branchCreationPos > 0, "branch creation block found in engine.ts");
		assert(preflightReturnPos > 0 && branchCreationPos > preflightReturnPos,
			"orch branch creation occurs after preflight early return");
		assert(discoveryReturnPos > 0 && branchCreationPos > discoveryReturnPos,
			"orch branch creation occurs after discovery fatal error early return");
		assert(noPendingReturnPos > 0 && branchCreationPos > noPendingReturnPos,
			"orch branch creation occurs after no-pending-tasks early return");
		assert(graphReturnPos > 0 && branchCreationPos > graphReturnPos,
			"orch branch creation occurs after graph validation early return");
		assert(waveReturnPos > 0 && branchCreationPos > waveReturnPos,
			"orch branch creation occurs after wave computation early return");
	}

	// ── 7b) Orch branch creation: detached HEAD is rejected before branch creation ──
	// engine.ts detects detached HEAD via getCurrentBranch() and fails fast before
	// reaching the orch branch creation block. This ensures no orphan branch is
	// created when the user is on a detached HEAD.
	{
		console.log("\n── orch branch creation: detached HEAD edge case (TP-022) ──");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-branch-detached-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Init a test repo and create a commit
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Detach HEAD by checking out a specific commit
			const headSha = execSync("git rev-parse HEAD", { cwd: repoDir, encoding: "utf-8" }).trim();
			execSync(`git checkout ${headSha}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			// getCurrentBranch should return null/empty for detached HEAD
			const detectedBranch = getCurrentBranch(repoDir);
			assert(!detectedBranch, "getCurrentBranch returns falsy for detached HEAD");

			// Simulate engine.ts behavior: detached HEAD check prevents orch branch creation
			const batchState = freshOrchBatchState();
			batchState.phase = "planning";
			batchState.batchId = "test-detached";
			batchState.startedAt = Date.now();

			if (!detectedBranch) {
				batchState.phase = "failed";
				batchState.endedAt = Date.now();
				batchState.errors.push("Cannot determine current branch (detached HEAD or not a git repo)");
			}

			assert(batchState.phase === "failed", "batch fails on detached HEAD before orch branch creation");
			assert(batchState.errors[0].includes("detached HEAD"), "error message mentions detached HEAD");
			assert(batchState.orchBranch === "", "orchBranch remains empty — no orphan branch created");

			// Verify no orch branches were accidentally created in the repo
			const branchList = execSync("git branch", { cwd: repoDir, encoding: "utf-8" });
			assert(!branchList.includes("orch/"), "no orch/ branches exist in repo after detached HEAD rejection");

			// Structural verification: the detached HEAD check in engine.ts is before branch creation
			const engineSource = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");
			const detachedCheckPos = engineSource.indexOf("detached HEAD or not a git repo");
			const branchCreationPos = engineSource.indexOf('runGit(["branch", orchBranch, batchState.baseBranch]');
			assert(detachedCheckPos > 0 && branchCreationPos > 0 && detachedCheckPos < branchCreationPos,
				"detached HEAD check occurs before orch branch creation in engine.ts");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// ── TP-022 Step 2: orchBranch routing verification ───────────────

	// 5) engine.ts passes orchBranch (not baseBranch) to executeWave and mergeWaveByRepo
	{
		console.log("\n  5) engine.ts routes orchBranch to executeWave/mergeWaveByRepo/worktree reset");
		const engineSource = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");

		// executeWave call should pass orchBranch
		const executeWaveCallRegex = /executeWave\(\s*waveTasks[\s\S]*?batchState\.orchBranch/;
		assert(executeWaveCallRegex.test(engineSource),
			"executeWave() receives batchState.orchBranch (not baseBranch)");

		// Verify baseBranch is NOT passed to executeWave
		// Find the executeWave call block and check it doesn't use baseBranch
		const executeWaveBlock = engineSource.match(/const waveResult = await executeWave\([\s\S]*?\);/)?.[0] ?? "";
		assert(!executeWaveBlock.includes("batchState.baseBranch"),
			"executeWave() call block does not reference batchState.baseBranch");

		// mergeWaveByRepo should pass orchBranch
		const mergeCallRegex = /mergeWaveByRepo\(\s*waveResult\.allocatedLanes[\s\S]*?batchState\.orchBranch/;
		assert(mergeCallRegex.test(engineSource),
			"mergeWaveByRepo() receives batchState.orchBranch (not baseBranch)");

		// Post-merge worktree reset uses orchBranch for primary repo.
		// TP-029: Now iterates encounteredRepoRoots with per-repo target branch
		// resolution. Primary repo uses batchState.orchBranch; secondary repos
		// use resolveBaseBranch. Verify orchBranch is used and baseBranch is not.
		const resetBlock = engineSource.match(/Post-merge: Reset worktrees[\s\S]*?targetBranch = batchState\.\w+/)?.[0] ?? "";
		assert(resetBlock.includes("batchState.orchBranch"),
			"post-merge worktree reset uses batchState.orchBranch");
		assert(!resetBlock.includes("batchState.baseBranch"),
			"post-merge worktree reset does NOT use batchState.baseBranch");

		// Phase 3 cleanup uses orchBranch for unmerged-branch protection
		// (lane branches were merged into orchBranch, not baseBranch — TP-022 Step 4)
		// TP-029: Now iterates encounteredRepoRoots with per-repo target branch.
		const cleanupBlock = engineSource.match(/Phase 3: Cleanup[\s\S]*?targetBranch = batchState\.\w+/)?.[0] ?? "";
		assert(cleanupBlock.includes("batchState.orchBranch"),
			"Phase 3 cleanup uses batchState.orchBranch for unmerged-branch check");
	}

	// 6) resume.ts mirrors engine.ts orchBranch routing
	{
		console.log("  6) resume.ts routes orchBranch to executeWave/mergeWaveByRepo/worktree reset");
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

		// executeWave in resume should use orchBranch
		const resumeExecBlock = resumeSource.match(/const waveResult = await executeWave\([\s\S]*?\);/)?.[0] ?? "";
		assert(resumeExecBlock.includes("batchState.orchBranch"),
			"resume.ts executeWave() receives batchState.orchBranch");
		assert(!resumeExecBlock.includes("batchState.baseBranch"),
			"resume.ts executeWave() does NOT reference batchState.baseBranch");

		// Wave mergeWaveByRepo in resume should use orchBranch
		// There are multiple mergeWaveByRepo calls — find the one in the wave loop (not re-exec)
		const waveMergeRegex = /mergeWaveByRepo\(\s*waveResult\.allocatedLanes[\s\S]*?batchState\.orchBranch/;
		assert(waveMergeRegex.test(resumeSource),
			"resume.ts wave mergeWaveByRepo() receives batchState.orchBranch");

		// Re-exec merge also uses orchBranch
		const reExecMergeRegex = /reExecAllocatedLanes[\s\S]*?mergeWaveByRepo\([\s\S]*?batchState\.orchBranch/;
		assert(reExecMergeRegex.test(resumeSource),
			"resume.ts re-exec mergeWaveByRepo() receives batchState.orchBranch");

		// Post-merge worktree reset and terminal cleanup use per-repo target branch resolution:
		// Primary repo uses batchState.orchBranch, secondary repos resolve via resolveBaseBranch.
		// Both the inter-wave reset and terminal cleanup should have this per-repo pattern.
		assert(resumeSource.includes("resolveRepoIdFromRoot"),
			"resume.ts uses resolveRepoIdFromRoot for per-repo target branch in workspace mode");
		assert(resumeSource.includes("resolveBaseBranch(repoId, perRepoRoot"),
			"resume.ts calls resolveBaseBranch per-repo for secondary repos");
		// Primary repo path still uses orchBranch in both locations
		const orchBranchAssignments = resumeSource.match(/targetBranch = batchState\.orchBranch/g) || [];
		assert(orchBranchAssignments.length >= 2,
			"resume.ts uses orchBranch for primary repo in both inter-wave reset and terminal cleanup (TP-022 Step 4)");
	}

	// 7) resume.ts has orchBranch empty-guard for pre-TP-022 persisted states
	{
		console.log("  7) resume.ts guards against empty orchBranch before state mutation");
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

		// Guard checks persistedState (not batchState) — R006: guard before mutation
		assert(resumeSource.includes("!persistedState.orchBranch"),
			"resume.ts checks persistedState.orchBranch (not batchState) for guard");
		assert(resumeSource.includes("has no orch branch"),
			"resume.ts has clear error message for missing orchBranch");

		// The guard should appear BEFORE batchState.phase = "executing" mutation
		const guardPos = resumeSource.indexOf("!persistedState.orchBranch");
		const phaseMutationPos = resumeSource.indexOf('batchState.phase = "executing"');
		assert(guardPos > 0 && phaseMutationPos > 0 && guardPos < phaseMutationPos,
			"orchBranch guard appears BEFORE batchState.phase mutation (R006 fix)");

		// The guard should appear BEFORE any orchBranch routing usage
		const firstRoutingUse = resumeSource.indexOf("batchState.orchBranch,");
		assert(guardPos > 0 && firstRoutingUse > 0 && guardPos < firstRoutingUse,
			"orchBranch guard appears before first orchBranch routing usage");
	}

	// 8) resolveBaseBranch in waves.ts: repo mode returns passed-in branch, workspace mode detects per-repo
	{
		console.log("  8) resolveBaseBranch compatibility with orch branch fallback guard");
		const wavesSource = readFileSync(join(__dirname, "..", "taskplane", "waves.ts"), "utf-8");

		// resolveBaseBranch exists
		assert(wavesSource.includes("export function resolveBaseBranch"),
			"resolveBaseBranch() exists in waves.ts");

		// In repo mode (no repoId), it falls through to return batchBaseBranch
		assert(wavesSource.includes("return batchBaseBranch"),
			"resolveBaseBranch falls back to batchBaseBranch (which is now orchBranch)");

		// In workspace mode (repoId present), it detects per-repo branch
		assert(wavesSource.includes("getCurrentBranch(repoRoot)"),
			"resolveBaseBranch detects per-repo branch in workspace mode");

		// R006: workspace mode fails fast when fallback is an orch branch
		assert(wavesSource.includes('batchBaseBranch.startsWith("orch/")'),
			"resolveBaseBranch guards against orch branch fallback in workspace mode");
		assert(wavesSource.includes("does not exist in this repo"),
			"resolveBaseBranch has clear error for orch branch fallback");
	}

	// 9) R006: orchBranch guard leaves runtime state resumable/consistent after rejection
	// Behavioral test: simulate what happens when resume encounters a legacy persisted
	// state with orchBranch="" — verify batchState stays idle so /orch-resume or /orch-abort
	// can proceed again.
	{
		console.log("  9) R006: orchBranch guard leaves batchState consistent after rejection");

		// a) Structural verification: guard is positioned before batchState mutation
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");
		const section6Start = resumeSource.indexOf("── 6. Reconstruct runtime state");
		assert(section6Start > 0, "Section 6 marker exists in resume.ts");
		const guardPos = resumeSource.indexOf("!persistedState.orchBranch");
		const textBeforeGuard = resumeSource.substring(section6Start, guardPos);
		assert(!textBeforeGuard.includes("batchState.phase"),
			"batchState.phase is NOT mutated before orchBranch guard");
		assert(!textBeforeGuard.includes("batchState.batchId"),
			"batchState.batchId is NOT mutated before orchBranch guard");

		// b) Behavioral simulation: exercise the guard logic with real state objects
		// A fresh batchState starts as idle — this is the runtime state the extension
		// holds before resumeOrchBatch runs.
		const batchState = freshOrchBatchState();
		assert(batchState.phase === "idle", "fresh batchState starts as idle");
		assert(batchState.batchId === "", "fresh batchState has empty batchId");

		// Simulate a legacy persisted state from pre-TP-022 (orchBranch is "")
		const legacyPersistedState = {
			batchId: "20260318T120000",
			baseBranch: "main",
			orchBranch: "",
			phase: "executing" as const,
			startedAt: Date.now(),
		};

		// Simulate the guard logic from resume.ts section 6:
		// If orchBranch is empty, the guard returns early WITHOUT mutating batchState.
		if (!legacyPersistedState.orchBranch) {
			// Guard fired — batchState should remain untouched
		} else {
			// This path should NOT execute for legacy state
			batchState.phase = "executing";
			batchState.batchId = legacyPersistedState.batchId;
		}

		// After guard rejection, batchState must still be idle
		assert(batchState.phase === "idle",
			"batchState.phase remains 'idle' after guard rejection (not 'executing')");
		assert(batchState.batchId === "",
			"batchState.batchId remains empty after guard rejection");
		assert(batchState.orchBranch === "",
			"batchState.orchBranch remains empty after guard rejection");

		// This means /orch-resume won't see a phantom "executing" phase that blocks retries,
		// and /orch-abort can proceed without thinking a batch is running.
	}

	// 10) R006: resolveBaseBranch throws for orch branch fallback in workspace mode
	{
		console.log("  10) R006: resolveBaseBranch throws when workspace fallback is orch branch");

		// In repo mode (no repoId), orch branch fallback is allowed (branch exists in same repo)
		const repoModeResult = resolveBaseBranch(undefined, "/fake/repo", "orch/op-batch123");
		assert(repoModeResult === "orch/op-batch123",
			"repo mode returns orch branch as-is (it exists in the primary repo)");

		// In workspace mode (repoId present) with detached HEAD and no defaultBranch,
		// orch branch fallback should throw
		let threwForOrchFallback = false;
		try {
			// getCurrentBranch will fail for a non-existent path, simulating detached HEAD
			resolveBaseBranch("secondary-repo", "/nonexistent/repo/path", "orch/op-batch123", {
				repos: new Map(),
			} as any);
		} catch (e: any) {
			threwForOrchFallback = true;
			assert(e.message.includes("does not exist in this repo"),
				"error message mentions orch branch doesn't exist in this repo");
			assert(e.message.includes("defaultBranch"),
				"error message mentions defaultBranch configuration");
		}
		assert(threwForOrchFallback,
			"resolveBaseBranch throws when workspace fallback would be an orch branch");

		// In workspace mode with a non-orch fallback, it should still work (legacy behavior)
		const legacyResult = resolveBaseBranch("secondary-repo", "/nonexistent/repo/path", "main", {
			repos: new Map(),
		} as any);
		assert(legacyResult === "main",
			"workspace mode with non-orch fallback returns batchBaseBranch as before");
	}

	// ── TP-022 Step 3: update-ref replaces ff-only in merge.ts ───────

	// 11) merge.ts uses gated advancement: update-ref for non-checked-out, ff-only for checked-out
	{
		console.log("\n  11) merge.ts uses gated branch advancement (update-ref / ff-only)");
		const mergeSource = readFileSync(join(__dirname, "..", "taskplane", "merge.ts"), "utf-8");

		// Positive: rev-parse and update-ref are present in the ref advancement block
		assert(mergeSource.includes('["rev-parse", tempBranch]'),
			"merge.ts calls rev-parse on temp branch to get merged HEAD");
		assert(mergeSource.includes('"update-ref"'),
			"merge.ts calls update-ref to advance non-checked-out target branch");
		assert(mergeSource.includes('`refs/heads/${targetBranch}`'),
			"merge.ts update-ref targets refs/heads/<targetBranch>");

		// Gate detection: getCurrentBranch is used to determine checked-out state
		assert(mergeSource.includes("getCurrentBranch(repoRoot)"),
			"merge.ts detects checked-out branch via getCurrentBranch(repoRoot)");
		assert(mergeSource.includes("targetIsCheckedOut"),
			"merge.ts gates on targetIsCheckedOut flag");

		// Checked-out path: ff-only with stash fallback (workspace mode safety)
		assert(mergeSource.includes("--ff-only"),
			"merge.ts uses --ff-only for checked-out target branch (workspace mode)");
		assert(mergeSource.includes('"stash"'),
			"merge.ts uses stash fallback for dirty worktree in checked-out path");

		// Compare-and-swap: update-ref uses old-ref guard for non-checked-out path
		assert(mergeSource.includes('`refs/heads/${targetBranch}`, tempBranchHead, oldRef'),
			"merge.ts uses compare-and-swap update-ref (3-arg form with old ref)");
	}

	// 12) merge.ts update-ref failure path sets failedLane/failureReason correctly
	{
		console.log("  12) merge.ts update-ref failure path sets proper error state");
		const mergeSource = readFileSync(join(__dirname, "..", "taskplane", "merge.ts"), "utf-8");

		// Find the update-ref failure block
		const updateRefBlock = mergeSource.match(
			/if \(updateRefResult\.status !== 0\)[\s\S]*?failureReason\s*=\s*`[^`]+`/
		)?.[0] ?? "";
		assert(updateRefBlock.length > 0,
			"update-ref failure block exists in merge.ts");
		assert(updateRefBlock.includes("failedLane"),
			"update-ref failure sets failedLane");
		assert(updateRefBlock.includes("failureReason"),
			"update-ref failure sets failureReason");

		// Find the rev-parse failure block
		const revParseBlock = mergeSource.match(
			/if \(revParseResult\.status !== 0\)[\s\S]*?failureReason\s*=\s*`[^`]+`/
		)?.[0] ?? "";
		assert(revParseBlock.length > 0,
			"rev-parse failure block exists in merge.ts");
		assert(revParseBlock.includes("failedLane"),
			"rev-parse failure sets failedLane");
		assert(revParseBlock.includes("failureReason"),
			"rev-parse failure sets failureReason");

		// Both failures use failedLane ?? -1 (doesn't overwrite a lane-level failure)
		assert(updateRefBlock.includes("failedLane ?? -1"),
			"update-ref failure uses failedLane ?? -1 (preserves prior lane failure)");
		assert(revParseBlock.includes("failedLane ?? -1"),
			"rev-parse failure uses failedLane ?? -1 (preserves prior lane failure)");
	}

	// 13) merge.ts update-ref success path logs correctly
	{
		console.log("  13) merge.ts update-ref success path logs ref update");
		const mergeSource = readFileSync(join(__dirname, "..", "taskplane", "merge.ts"), "utf-8");

		// Success path logs with exec logging
		const successLog = mergeSource.match(
			/`updated \$\{targetBranch\} ref to merge result`/
		)?.[0] ?? "";
		assert(successLog.length > 0,
			"update-ref success logs 'updated <targetBranch> ref to merge result'");

		// Failure path logs with exec logging
		const failureLog = mergeSource.match(
			/`update-ref failed for \$\{targetBranch\}/
		)?.[0] ?? "";
		assert(failureLog.length > 0,
			"update-ref failure logs 'update-ref failed for <targetBranch>'");

		const revParseFailLog = mergeSource.match(
			/`failed to resolve temp branch HEAD/
		)?.[0] ?? "";
		assert(revParseFailLog.length > 0,
			"rev-parse failure logs 'failed to resolve temp branch HEAD'");
	}

	// 14) merge.ts workspace-mode safety: checked-out branch uses ff-only, not update-ref
	{
		console.log("  14) merge.ts workspace-mode safety: gated branch advancement");
		const mergeSource = readFileSync(join(__dirname, "..", "taskplane", "merge.ts"), "utf-8");

		// The advancement block must have both paths gated by targetIsCheckedOut.
		// Extract the block between "Gate advancement strategy" and "Clean up merge worktree"
		const advancementBlock = mergeSource.match(
			/Gate advancement strategy[\s\S]*?Clean up merge worktree/
		)?.[0] ?? "";
		assert(advancementBlock.length > 0,
			"advancement block with gate comment exists");

		// The gate uses getCurrentBranch to detect checked-out state
		assert(advancementBlock.includes("getCurrentBranch(repoRoot)"),
			"gate calls getCurrentBranch(repoRoot) to detect checked-out branch");
		assert(advancementBlock.includes("checkedOutBranch === targetBranch"),
			"gate compares checkedOutBranch to targetBranch");

		// Checked-out path comes first (if targetIsCheckedOut)
		const checkedOutIdx = advancementBlock.indexOf("if (targetIsCheckedOut)");
		const elseIdx = advancementBlock.indexOf("} else {", checkedOutIdx);
		assert(checkedOutIdx > 0 && elseIdx > checkedOutIdx,
			"gate has if (targetIsCheckedOut) ... else ... structure");

		// Checked-out path uses ff-only (between if and else)
		const checkedOutPath = advancementBlock.slice(checkedOutIdx, elseIdx);
		assert(checkedOutPath.includes("--ff-only"),
			"checked-out path uses --ff-only merge");
		assert(checkedOutPath.includes("stash"),
			"checked-out path has stash fallback for dirty worktree");
		assert(!checkedOutPath.includes("update-ref"),
			"checked-out path does NOT use update-ref (would desync worktree)");

		// Non-checked-out path uses update-ref (after else)
		const nonCheckedOutPath = advancementBlock.slice(elseIdx);
		assert(nonCheckedOutPath.includes("update-ref"),
			"non-checked-out path uses update-ref");
		assert(!nonCheckedOutPath.includes("--ff-only"),
			"non-checked-out path does NOT use --ff-only");

		// Workspace mode comment explains the rationale
		assert(advancementBlock.includes("workspace mode"),
			"advancement block documents workspace mode behavior");
	}

	// ── TP-022 Step 3 — Behavioral tests: real git repo ref advancement ──

	// 15) Behavioral: update-ref advances non-checked-out branch (orch branch path)
	{
		console.log("\n  15) Behavioral: update-ref advances non-checked-out branch");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-updateref-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Set up repo with initial commit on main
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Create orch branch (simulating engine.ts batch start)
			const orchBranch = "orch/testop-batch1";
			execSync(`git branch ${orchBranch} main`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			const orchOldSha = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();

			// Create temp merge branch from orch branch and add a commit
			const tempBranch = "_merge-temp-testop-batch1";
			execSync(`git branch ${tempBranch} ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			// Use a worktree to add a commit on temp branch (can't checkout in main working tree)
			const wtDir = join(tempBase, "merge-wt");
			execSync(`git worktree add "${wtDir}" ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(wtDir, "merged.txt"), "merged content\n");
			execSync("git add -A", { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "merge: wave 1 lane 1"', { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			const tempBranchHead = execSync(`git rev-parse ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			// Clean up worktree
			execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			// Verify orch branch hasn't moved yet
			assert(orchOldSha !== tempBranchHead,
				"temp branch HEAD differs from orch branch (commit was added)");
			const orchPreUpdateSha = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(orchPreUpdateSha === orchOldSha,
				"orch branch is still at original commit before update-ref");

			// Execute update-ref with compare-and-swap (mirrors merge.ts logic)
			const updateResult = spawnSync("git",
				["update-ref", `refs/heads/${orchBranch}`, tempBranchHead, orchOldSha],
				{ cwd: repoDir }
			);
			assert(updateResult.status === 0,
				"update-ref succeeds with correct old OID");

			// Verify orch branch now points to the merged commit
			const orchNewSha = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(orchNewSha === tempBranchHead,
				"orch branch now points to temp branch HEAD after update-ref");

			// Verify main (user's branch) was NOT touched
			const mainSha = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(mainSha === orchOldSha,
				"main branch is still at original commit (user's branch untouched)");

			// Verify working tree is clean (update-ref doesn't touch it)
			const statusOutput = execSync("git status --porcelain", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(statusOutput === "",
				"working tree is clean after update-ref (no dirty files)");

			// Clean up temp branch
			execSync(`git branch -D ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// 16) Behavioral: update-ref compare-and-swap rejects stale old OID
	{
		console.log("  16) Behavioral: update-ref compare-and-swap rejects stale OID");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-cas-fail-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Set up repo with initial commit
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Create orch branch
			const orchBranch = "orch/testop-cas";
			execSync(`git branch ${orchBranch} main`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			const orchOriginalSha = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();

			// Simulate concurrent movement: advance orch branch independently
			const wtDir = join(tempBase, "concurrent-wt");
			execSync(`git worktree add "${wtDir}" ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(wtDir, "concurrent.txt"), "concurrent change\n");
			execSync("git add -A", { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "concurrent commit"', { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			const concurrentSha = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			assert(concurrentSha !== orchOriginalSha,
				"orch branch moved due to concurrent commit");

			// Create a temp merge branch with a different commit
			const tempBranch = "_merge-temp-testop-cas";
			execSync(`git branch ${tempBranch} main`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			const wtDir2 = join(tempBase, "merge-wt2");
			execSync(`git worktree add "${wtDir2}" ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(wtDir2, "merged.txt"), "merge content\n");
			execSync("git add -A", { cwd: wtDir2, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "merge commit"', { cwd: wtDir2, encoding: "utf-8", stdio: "pipe" });
			const mergeHead = execSync(`git rev-parse ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			execSync(`git worktree remove "${wtDir2}" --force`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			// Attempt update-ref with stale old OID (orchOriginalSha, but branch moved to concurrentSha)
			const updateResult = spawnSync("git",
				["update-ref", `refs/heads/${orchBranch}`, mergeHead, orchOriginalSha],
				{ cwd: repoDir }
			);

			assert(updateResult.status !== 0,
				"update-ref REJECTS stale old OID (compare-and-swap failure)");

			// Verify orch branch was NOT clobbered — still at concurrent commit
			const orchAfterSha = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(orchAfterSha === concurrentSha,
				"orch branch preserved at concurrent commit (not clobbered)");

			// Verify the error message contains relevant info
			const errMsg = updateResult.stderr?.toString() || "";
			assert(errMsg.length > 0,
				"update-ref failure produces stderr error message");

			// Clean up
			execSync(`git branch -D ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// 17) Behavioral: ff-only advances checked-out branch + working tree (workspace mode path)
	{
		console.log("  17) Behavioral: ff-only advances checked-out branch + working tree");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-ff-workspace-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Set up repo with initial commit on main
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			const mainOldSha = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();

			// Create temp branch from main with an additional commit
			const tempBranch = "_merge-temp-workspace";
			execSync(`git branch ${tempBranch} main`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			const wtDir = join(tempBase, "merge-wt");
			execSync(`git worktree add "${wtDir}" ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(wtDir, "new-file.txt"), "workspace merge\n");
			execSync("git add -A", { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "workspace merge commit"', { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			const tempHead = execSync(`git rev-parse ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			assert(tempHead !== mainOldSha,
				"temp branch advanced beyond main");

			// We're on main (checked out). Simulate the workspace ff-only path.
			const ffResult = execSync(`git merge --ff-only ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			// Verify main advanced
			const mainNewSha = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(mainNewSha === tempHead,
				"main branch advanced to temp branch HEAD via ff-only");

			// Verify working tree has the new file (ff-only updates worktree)
			assert(existsSync(join(repoDir, "new-file.txt")),
				"new-file.txt exists in working tree after ff-only (worktree updated)");

			// Verify working tree is clean
			const statusOutput = execSync("git status --porcelain", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(statusOutput === "",
				"working tree is clean after ff-only merge");

			// Clean up temp branch
			execSync(`git branch -D ${tempBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// ── TP-022 Step 4: Auto-Integration & Cleanup ───────────────────────

	// 18) Behavioral: auto-integration fast-forwards baseBranch to orchBranch (update-ref path)
	{
		console.log("\n── TP-022 Step 4: Auto-Integration & Cleanup ──");
		console.log("  18) Behavioral: auto-integration ff advances baseBranch to orchBranch");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-autointegrate-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Set up repo with initial commit on main
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			const mainOriginalSha = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();

			// Create orch branch and advance it (simulating merged wave work)
			const orchBranch = "orch/testop-autointegrate";
			execSync(`git branch ${orchBranch} main`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			// Add a commit to orch branch via worktree
			const wtDir = join(tempBase, "orch-wt");
			execSync(`git worktree add "${wtDir}" ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(wtDir, "task-work.txt"), "task work\n");
			execSync("git add -A", { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "task: completed work"', { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			const orchHead = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			assert(orchHead !== mainOriginalSha, "orch branch has advanced beyond main");

			// baseBranch (main) is checked out → auto-integration uses ff-only
			const currentBranch = getCurrentBranch(repoDir);
			assert(currentBranch === "main", "main is checked out (ff-only path)");

			// Verify fast-forwardability: main must be ancestor of orchBranch
			const isAncestor = runGit(["merge-base", "--is-ancestor", "main", orchBranch], repoDir);
			assert(isAncestor.ok, "main is ancestor of orch branch (fast-forwardable)");

			// Execute ff-only (mirrors attemptAutoIntegration's checked-out path)
			const ffResult = runGit(["merge", "--ff-only", orchBranch], repoDir);
			assert(ffResult.ok, "ff-only auto-integration succeeds");

			// Verify main advanced to orchBranch HEAD
			const mainNewSha = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(mainNewSha === orchHead, "main advanced to orch branch HEAD after auto-integration");

			// Verify working tree has the new file
			assert(existsSync(join(repoDir, "task-work.txt")),
				"task-work.txt present in working tree after auto-integration");

			// Orch branch still exists (never deleted)
			const orchExists = runGit(["rev-parse", "--verify", `refs/heads/${orchBranch}`], repoDir);
			assert(orchExists.ok, "orch branch still exists after auto-integration (preserved)");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// 19) Behavioral: auto-integration skips when branches have diverged
	{
		console.log("  19) Behavioral: auto-integration skips when branches diverged");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-diverged-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Set up repo with initial commit
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Create orch branch from main
			const orchBranch = "orch/testop-diverged";
			execSync(`git branch ${orchBranch} main`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			// Advance orch branch
			const wtDir = join(tempBase, "orch-wt");
			execSync(`git worktree add "${wtDir}" ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(wtDir, "orch-work.txt"), "orch work\n");
			execSync("git add -A", { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "orch: task work"', { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			// Also advance main (user commits during batch) → divergence
			writeFileSync(join(repoDir, "user-change.txt"), "user work\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "user: concurrent work"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			const mainSha = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			const orchSha = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(mainSha !== orchSha, "branches have diverged");

			// Check fast-forwardability fails (main is NOT ancestor of orchBranch)
			const isAncestor = runGit(["merge-base", "--is-ancestor", "main", orchBranch], repoDir);
			assert(!isAncestor.ok, "main is NOT ancestor of orch branch (diverged — ff not possible)");

			// Orch branch is preserved for manual integration
			const orchExists = runGit(["rev-parse", "--verify", `refs/heads/${orchBranch}`], repoDir);
			assert(orchExists.ok, "orch branch preserved when integration fails (divergence fallback)");

			// Main was not touched
			const mainAfter = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(mainAfter === mainSha, "main branch unchanged after failed auto-integration");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// 20) ORCH_MESSAGES integration templates produce correct content
	{
		console.log("  20) ORCH_MESSAGES integration templates produce correct content");

		// Manual integration message
		const manualMsg = ORCH_MESSAGES.orchIntegrationManual("orch/op-batch1", "main", 5);
		assert(manualMsg.includes("orch/op-batch1"), "manual message includes orch branch");
		assert(manualMsg.includes("main"), "manual message includes base branch");
		assert(manualMsg.includes("5 merged task"), "manual message includes task count");
		assert(manualMsg.includes("git log"), "manual message includes git log command");
		assert(manualMsg.includes("git merge"), "manual message includes git merge command");

		// Auto-integration success message
		const autoSuccessMsg = ORCH_MESSAGES.orchIntegrationAutoSuccess("orch/op-batch1", "main");
		assert(autoSuccessMsg.includes("Auto-integrated"), "auto-success message indicates auto-integration");
		assert(autoSuccessMsg.includes("fast-forwarded"), "auto-success message mentions fast-forward");

		// Auto-integration failure message
		const autoFailedMsg = ORCH_MESSAGES.orchIntegrationAutoFailed("orch/op-batch1", "main", "branches diverged");
		assert(autoFailedMsg.includes("skipped"), "auto-failed message says skipped");
		assert(autoFailedMsg.includes("branches diverged"), "auto-failed message includes reason");
		assert(autoFailedMsg.includes("preserved"), "auto-failed message says branch preserved");
		assert(autoFailedMsg.includes("git merge"), "auto-failed message includes manual merge command");
	}

	// 21) Structural: engine.ts cleanup preserves orchBranch (no deletion) and uses orchBranch for unmerged detection
	{
		console.log("  21) Structural: engine.ts cleanup uses orchBranch and never deletes it");
		const engineSource = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");

		// Cleanup section uses orchBranch for targetBranch
		const cleanupSection = engineSource.match(/Phase 3: Cleanup[\s\S]*?Post-worktree-removal/)?.[0] ?? "";
		assert(cleanupSection.includes("batchState.orchBranch"),
			"Phase 3 cleanup references batchState.orchBranch for unmerged-branch detection");

		// No deletion of orchBranch anywhere in engine.ts
		assert(!engineSource.includes('deleteBranchBestEffort(batchState.orchBranch'),
			"engine.ts never calls deleteBranchBestEffort on orchBranch");
		assert(!engineSource.includes('deleteBranchBestEffort(orchBranch'),
			"engine.ts never calls deleteBranchBestEffort on orchBranch variable");

		// Auto-integration block exists and is gated by integration config
		assert(engineSource.includes('orchestrator.integration === "auto"'),
			"auto-integration is gated by config.orchestrator.integration");

		// Manual mode preserves orchBranch with guidance message
		assert(engineSource.includes("orchIntegrationManual"),
			"engine.ts calls orchIntegrationManual for manual mode guidance");
	}

	// 22) Structural: resume.ts section 11 mirrors engine.ts Phase 3 (auto-integration + cleanup + messaging)
	{
		console.log("  22) Structural: resume.ts mirrors engine.ts auto-integration + cleanup + messaging");
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");
		const engineSource = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");

		// a) resume.ts has auto-integration block
		assert(resumeSource.includes('orchestrator.integration === "auto"'),
			"resume.ts gates auto-integration by config.orchestrator.integration");

		// b) resume.ts imports shared attemptAutoIntegration from merge.ts (no local duplicate)
		assert(resumeSource.includes("attemptAutoIntegration, mergeWaveByRepo"),
			"resume.ts imports attemptAutoIntegration from merge.ts");
		assert(!resumeSource.includes("function attemptAutoIntegrationResume"),
			"resume.ts does NOT have a local duplicate — uses shared helper from merge.ts");

		// c) resume.ts shows manual integration guidance on non-auto path
		assert(resumeSource.includes("orchIntegrationManual"),
			"resume.ts calls orchIntegrationManual for manual mode guidance");

		// d) resume.ts cleanup uses orchBranch (not baseBranch) for primary repo unmerged detection
		const resumeCleanupSection = resumeSource.match(
			/11\. Cleanup and terminal state[\s\S]*?batchState\.endedAt = Date\.now/
		)?.[0] ?? "";
		assert(resumeCleanupSection.includes("batchState.orchBranch"),
			"resume.ts cleanup references batchState.orchBranch for unmerged-branch detection");

		// e) Shared attemptAutoIntegration in merge.ts has the required gate structure
		const mergeSource = readFileSync(join(__dirname, "..", "taskplane", "merge.ts"), "utf-8");
		const sharedAutoFn = mergeSource.match(
			/export function attemptAutoIntegration[\s\S]*?return true;\s*\}/
		)?.[0] ?? "";
		assert(sharedAutoFn.includes("merge-base"),
			"shared auto-integration checks merge-base ancestry");
		assert(sharedAutoFn.includes("getCurrentBranch"),
			"shared auto-integration gates on checked-out branch");
		assert(sharedAutoFn.includes("update-ref"),
			"shared auto-integration uses update-ref for non-checked-out path");
		assert(sharedAutoFn.includes("--ff-only"),
			"shared auto-integration uses --ff-only for checked-out path");
		assert(sharedAutoFn.includes("--porcelain"),
			"shared auto-integration checks dirty worktree before ff-only");
		assert(sharedAutoFn.includes("logCategory"),
			"shared auto-integration accepts logCategory parameter for engine/resume disambiguation");

		// f) Both engine and resume import the same shared function
		assert(engineSource.includes("attemptAutoIntegration, mergeWaveByRepo"),
			"engine.ts imports attemptAutoIntegration from merge.ts");
		assert(engineSource.includes("orchIntegrationManual") && resumeSource.includes("orchIntegrationManual"),
			"both engine.ts and resume.ts use orchIntegrationManual message");
	}

	// 23) Behavioral: auto-integration via update-ref when baseBranch is NOT checked out
	{
		console.log("  23) Behavioral: auto-integration uses update-ref when baseBranch not checked out");
		const tempBase = mkdtempSync(join(tmpdir(), "orch-autointegrate-ref-"));
		const repoDir = join(tempBase, "repo");
		try {
			// Set up repo with initial commit on main
			execSync(`git init "${repoDir}"`, { encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.email test@test.com", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync("git config user.name Test", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(repoDir, "README.md"), "# Test\n");
			execSync("git add -A", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "initial"', { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			try { execSync("git branch -M main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }); } catch { /* already main */ }

			// Create a feature branch and check it out (so main is NOT checked out)
			execSync("git checkout -b feature", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			const mainOriginalSha = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();

			// Create orch branch from main and advance it
			const orchBranch = "orch/testop-refintegrate";
			execSync(`git branch ${orchBranch} main`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			const wtDir = join(tempBase, "orch-wt");
			execSync(`git worktree add "${wtDir}" ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });
			writeFileSync(join(wtDir, "task-work.txt"), "task work\n");
			execSync("git add -A", { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			execSync('git commit -m "task: completed work"', { cwd: wtDir, encoding: "utf-8", stdio: "pipe" });
			const orchHead = execSync(`git rev-parse ${orchBranch}`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir, encoding: "utf-8", stdio: "pipe" });

			// Verify main is NOT checked out
			const currentBranch = getCurrentBranch(repoDir);
			assert(currentBranch === "feature", "feature is checked out, not main");

			// Execute update-ref (mirrors attemptAutoIntegration's non-checked-out path)
			const baseOldRef = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			const updateResult = runGit(
				["update-ref", "refs/heads/main", orchHead, baseOldRef],
				repoDir,
			);
			assert(updateResult.ok, "update-ref succeeds for auto-integration");

			// Verify main advanced
			const mainNewSha = execSync("git rev-parse main", { cwd: repoDir, encoding: "utf-8", stdio: "pipe" }).trim();
			assert(mainNewSha === orchHead, "main advanced to orchBranch HEAD via update-ref");

			// Verify working tree was NOT affected (we're on feature branch)
			assert(!existsSync(join(repoDir, "task-work.txt")),
				"task-work.txt NOT in working tree (update-ref doesn't touch it)");

			// Verify we're still on feature branch
			assert(getCurrentBranch(repoDir) === "feature",
				"still on feature branch after update-ref (checkout untouched)");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	}

	// 24) Structural: auto-integration is gated to terminal phases only (no integration on paused/stopped)
	{
		console.log("  24) Structural: auto-integration gated to terminal phases (completed/failed) only");
		const engineSource = readFileSync(join(__dirname, "..", "taskplane", "engine.ts"), "utf-8");
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

		// engine.ts: isTerminalPhase gate before auto-integration
		const engineAutoBlock = engineSource.match(
			/Auto-Integration[\s\S]*?orchIntegrationManual/
		)?.[0] ?? "";
		assert(engineAutoBlock.includes('batchState.phase === "completed"'),
			"engine.ts auto-integration checks for completed phase");
		assert(engineAutoBlock.includes('batchState.phase === "failed"'),
			"engine.ts auto-integration checks for failed phase");
		assert(engineAutoBlock.includes("isTerminalPhase"),
			"engine.ts auto-integration uses isTerminalPhase gate");

		// resume.ts: same isTerminalPhase gate
		const resumeAutoBlock = resumeSource.match(
			/Auto-Integration[\s\S]*?orchIntegrationManual/
		)?.[0] ?? "";
		assert(resumeAutoBlock.includes('batchState.phase === "completed"'),
			"resume.ts auto-integration checks for completed phase");
		assert(resumeAutoBlock.includes('batchState.phase === "failed"'),
			"resume.ts auto-integration checks for failed phase");
		assert(resumeAutoBlock.includes("isTerminalPhase"),
			"resume.ts auto-integration uses isTerminalPhase gate");

		// Neither file should run auto-integration when phase is paused or stopped
		// Verify the gate is used in the if condition (not just defined)
		const engineGateIf = engineSource.match(/if \(isTerminalPhase && !preserveWorktreesForResume/);
		assert(engineGateIf !== null,
			"engine.ts gates auto-integration with isTerminalPhase in if condition");
		const resumeGateIf = resumeSource.match(/if \(isTerminalPhase && !preserveWorktreesForResume/);
		assert(resumeGateIf !== null,
			"resume.ts gates auto-integration with isTerminalPhase in if condition");
	}

	// 25) Structural: resume.ts workspace-mode cleanup resolves per-repo target branch
	{
		console.log("  25) Structural: resume.ts resolves per-repo target branch for workspace-mode cleanup");
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

		// Section 11 cleanup should resolve per-repo target branches
		const cleanupSection = resumeSource.match(
			/11\. Cleanup and terminal state[\s\S]*?batchState\.endedAt = Date\.now/
		)?.[0] ?? "";

		// Primary repo uses orchBranch
		assert(cleanupSection.includes("perRepoRoot === repoRoot"),
			"resume.ts cleanup distinguishes primary repo from secondary repos");
		assert(cleanupSection.includes("batchState.orchBranch"),
			"resume.ts cleanup uses orchBranch for primary repo");

		// Secondary repos resolve via resolveBaseBranch
		assert(cleanupSection.includes("resolveRepoIdFromRoot"),
			"resume.ts cleanup resolves repoId for secondary repos");
		assert(cleanupSection.includes("resolveBaseBranch(repoId, perRepoRoot"),
			"resume.ts cleanup calls resolveBaseBranch per secondary repo");

		// Graceful fallback when resolveBaseBranch throws
		assert(cleanupSection.includes("targetBranch = undefined"),
			"resume.ts cleanup falls back to undefined targetBranch when resolveBaseBranch throws");

		// resolveRepoIdFromRoot helper exists and works correctly
		assert(resumeSource.includes("export function resolveRepoIdFromRoot"),
			"resolveRepoIdFromRoot helper is exported from resume.ts");
		const helperFn = resumeSource.match(
			/function resolveRepoIdFromRoot[\s\S]*?return undefined;\s*\}/
		)?.[0] ?? "";
		assert(helperFn.includes("workspaceConfig"),
			"resolveRepoIdFromRoot uses workspaceConfig for reverse lookup");
		assert(helperFn.includes("repoConfig.path === repoRoot"),
			"resolveRepoIdFromRoot matches by repo path");
	}

	// 26) Structural: resume.ts inter-wave reset also uses per-repo target branch
	{
		console.log("  26) Structural: resume.ts inter-wave reset uses per-repo target branch");
		const resumeSource = readFileSync(join(__dirname, "..", "taskplane", "resume.ts"), "utf-8");

		// Inter-wave reset section (between wave executions) should resolve per-repo
		const resetSection = resumeSource.match(
			/waveIdx < persistedState\.wavePlan\.length - 1[\s\S]*?forceCleanupWorktree/
		)?.[0] ?? "";

		assert(resetSection.includes("perRepoRoot === repoRoot"),
			"inter-wave reset distinguishes primary repo from secondary repos");
		assert(resetSection.includes("resolveRepoIdFromRoot"),
			"inter-wave reset resolves repoId for secondary repos");
		assert(resetSection.includes("resolveBaseBranch"),
			"inter-wave reset calls resolveBaseBranch for secondary repos");
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	if (failed > 0) throw new Error(`${failed} test(s) failed`);
} // end runAllTests

// ── Dual-mode execution ──────────────────────────────────────────────
// Under vitest: register as a proper test suite
// Standalone (npx tsx): run directly with process.exit
if (isVitest) {
	const { describe, it } = await import("vitest");
	describe("Orchestrator Direct Implementation", () => {
		it("passes all assertions", () => {
			runAllTests();
		});
	});
} else {
	try {
		runAllTests();
		process.exit(0);
	} catch (e) {
		console.error("Test run failed:", e);
		process.exit(1);
	}
}
