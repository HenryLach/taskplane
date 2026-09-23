import { it } from "node:test";
import { strict as assert } from "node:assert";
import { stripTypeScriptTypes } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

it("resolves templates from the running Pi-managed package outside the project's cwd", async () => {
	const root = mkdtempSync(join(tmpdir(), "tp-private-package-"));
	try {
		const installedRoot = join(root, ".pi", "agent", "npm", "node_modules", "taskplane");
		const resolverPath = join(installedRoot, "extensions", "taskplane", "path-resolver.mjs");
		mkdirSync(dirname(resolverPath), { recursive: true });
		// Pi transpiles installed TS modules. Strip types here so Node can load
		// the fixture under node_modules while retaining its real import.meta.url.
		const source = readFileSync(new URL("../taskplane/path-resolver.ts", import.meta.url), "utf8");
		writeFileSync(resolverPath, stripTypeScriptTypes(source));
		const relPath = join("templates", "agents", "task-merger.md");
		const templatePath = join(installedRoot, relPath);
		mkdirSync(dirname(templatePath), { recursive: true });
		writeFileSync(templatePath, "Installed merger prompt.");
		const projectRoot = join(root, "consumer-project");
		mkdirSync(projectRoot);
		const { resolveTaskplanePackageFile } = await import(pathToFileURL(resolverPath).href);
		assert.equal(resolveTaskplanePackageFile(projectRoot, relPath), templatePath);

		// Preserve the local-development override when the repo supplies a file.
		const localTemplate = join(projectRoot, relPath);
		mkdirSync(dirname(localTemplate), { recursive: true });
		writeFileSync(localTemplate, "Local development prompt.");
		assert.equal(resolveTaskplanePackageFile(projectRoot, relPath), localTemplate);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
