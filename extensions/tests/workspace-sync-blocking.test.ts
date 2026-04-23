import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import {
	getBlockingWorkspaceSyncFindings,
	hasBlockingWorkspaceSyncFindings,
} from "../taskplane/messages.ts";

describe("workspace sync blocking policy", () => {
	it("does not treat permissive findings as blocking", () => {
		const summary = {
			trackedSubmodules: 1,
			importCandidates: [],
			findings: [
				{
					name: "submodule-state:repo:vendor/private-assets",
					kind: "uninitialized-submodule",
					status: "warn",
					repoLabel: "repo",
					repoRoot: "/tmp/repo",
					submodulePath: "vendor/private-assets",
					message: "repo: submodule 'vendor/private-assets' is not initialized.",
				},
			],
		} as const;

		expect(hasBlockingWorkspaceSyncFindings(summary)).toBe(false);
		expect(getBlockingWorkspaceSyncFindings(summary)).toHaveLength(0);
	});

	it("treats strict findings as blocking", () => {
		const summary = {
			trackedSubmodules: 2,
			importCandidates: [],
			findings: [
				{
					name: "submodule-state:repo:vendor/private-assets",
					kind: "uninitialized-submodule",
					status: "warn",
					repoLabel: "repo",
					repoRoot: "/tmp/repo",
					submodulePath: "vendor/private-assets",
					message: "repo: submodule 'vendor/private-assets' is not initialized.",
				},
				{
					name: "submodule-state:repo:vendor/core-assets",
					kind: "drifted-submodule",
					status: "fail",
					repoLabel: "repo",
					repoRoot: "/tmp/repo",
					submodulePath: "vendor/core-assets",
					message: "repo: submodule 'vendor/core-assets' is drifted from the recorded gitlink commit.",
				},
			],
		} as const;

		expect(hasBlockingWorkspaceSyncFindings(summary)).toBe(true);
		expect(getBlockingWorkspaceSyncFindings(summary)).toHaveLength(1);
		expect(getBlockingWorkspaceSyncFindings(summary)[0].name).toBe(
			"submodule-state:repo:vendor/core-assets",
		);
	});
});