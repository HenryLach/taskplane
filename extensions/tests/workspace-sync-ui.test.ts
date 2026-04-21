import { describe, it } from "node:test";

import { expect } from "./expect.ts";
import { formatWorkspaceSyncPresentation } from "../taskplane/messages.ts";

describe("workspace sync UI presentation", () => {
	it("treats execution warnings as a failure", () => {
		const presentation = formatWorkspaceSyncPresentation({
			importedRepoIds: [],
			initializedPaths: [],
			updatedPaths: [],
			warnings: ["Failed to synchronize submodules in '/repo': error: pathspec did not match any file(s) known to git"],
			changed: false,
		}, {
			trackedSubmodules: 1,
			findings: [],
			importCandidates: [],
		});

		expect(presentation.status).toBe("failure");
		expect(presentation.notificationLevel).toBe("error");
		expect(presentation.message).toContain("❌ Workspace sync failed.");
	});

	it("keeps a no-op sync successful when only permissive warnings remain", () => {
		const presentation = formatWorkspaceSyncPresentation({
			importedRepoIds: [],
			initializedPaths: [],
			updatedPaths: [],
			warnings: [],
			changed: false,
		}, {
			trackedSubmodules: 1,
			findings: [{
				name: "submodule-state:main:vendor/docs",
				kind: "uninitialized-submodule",
				status: "warn",
				repoLabel: "main",
				repoRoot: "/repo",
				submodulePath: "vendor/docs",
				absolutePath: "/repo/vendor/docs",
				message: "main: submodule 'vendor/docs' is not initialized.",
			}],
			importCandidates: [],
		});

		expect(presentation.status).toBe("success");
		expect(presentation.notificationLevel).toBe("info");
		expect(presentation.message).toContain("ℹ️ Workspace sync made no changes.");
	});

	it("treats remaining blocking findings as a failure even if git reported no warnings", () => {
		const presentation = formatWorkspaceSyncPresentation({
			importedRepoIds: [],
			initializedPaths: [],
			updatedPaths: [],
			warnings: [],
			changed: false,
		}, {
			trackedSubmodules: 1,
			findings: [{
				name: "submodule-state:main:vendor/docs",
				kind: "uninitialized-submodule",
				status: "fail",
				repoLabel: "main",
				repoRoot: "/repo",
				submodulePath: "vendor/docs",
				absolutePath: "/repo/vendor/docs",
				message: "main: submodule 'vendor/docs' is not initialized.",
			}],
			importCandidates: [],
		});

		expect(presentation.status).toBe("failure");
		expect(presentation.notificationLevel).toBe("error");
		expect(presentation.message).toContain("❌ Workspace sync is still incomplete.");
	});
});