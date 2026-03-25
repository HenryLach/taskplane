/**
 * Tests for additive upgrade migrations (TP-063).
 *
 * Covers:
 * - Migration runner runs once and persists state in .pi/taskplane.json
 * - Existing files are never overwritten
 * - Idempotent re-runs skip already-applied migrations
 * - Failed migrations are reported but don't block subsequent ones
 * - State persistence merges safely with existing taskplane.json fields
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
	runMigrations,
	loadTaskplaneMeta,
	saveTaskplaneMeta,
	MIGRATION_REGISTRY,
	resolvePackageRoot,
} from "../taskplane/migrations.ts";
import type { MigrationState, TaskplaneMeta } from "../taskplane/migrations.ts";

// ── Test Helpers ─────────────────────────────────────────────────────

function createTempDir(): string {
	const dir = join(tmpdir(), `tp-migration-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function setupProjectDir(root: string): void {
	mkdirSync(join(root, ".pi"), { recursive: true });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("migrations", () => {
	let tempDir: string;
	let packageRoot: string;

	beforeEach(() => {
		tempDir = createTempDir();
		// Use the real package root so template files are available
		packageRoot = resolvePackageRoot();
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Best effort cleanup
		}
	});

	describe("runMigrations", () => {
		it("creates .pi/agents/supervisor.md when missing", () => {
			setupProjectDir(tempDir);

			const result = runMigrations(tempDir, packageRoot);

			expect(result.applied).toContain("add-supervisor-local-template-v1");
			expect(result.errors).toHaveLength(0);
			expect(result.messages.length).toBeGreaterThanOrEqual(1);
			expect(result.messages[0]).toContain("supervisor.md");

			// Verify file was created
			const targetPath = join(tempDir, ".pi", "agents", "supervisor.md");
			expect(existsSync(targetPath)).toBe(true);

			// Verify content matches template
			const created = readFileSync(targetPath, "utf-8");
			const template = readFileSync(
				join(packageRoot, "templates", "agents", "local", "supervisor.md"),
				"utf-8",
			);
			expect(created).toBe(template);
		});

		it("does not overwrite existing .pi/agents/supervisor.md", () => {
			setupProjectDir(tempDir);
			const targetDir = join(tempDir, ".pi", "agents");
			mkdirSync(targetDir, { recursive: true });
			const targetPath = join(targetDir, "supervisor.md");
			writeFileSync(targetPath, "# My custom supervisor\nCustom content.", "utf-8");

			const result = runMigrations(tempDir, packageRoot);

			// Migration still marked as applied/skipped (ran but target already existed)
			expect(result.errors).toHaveLength(0);

			// File should be unchanged
			const content = readFileSync(targetPath, "utf-8");
			expect(content).toBe("# My custom supervisor\nCustom content.");
		});

		it("persists migration state in .pi/taskplane.json", () => {
			setupProjectDir(tempDir);

			runMigrations(tempDir, packageRoot);

			// State should be in .pi/taskplane.json under migrations.applied
			const meta = loadTaskplaneMeta(tempDir);
			expect(meta.migrations).toBeDefined();
			const migrations = meta.migrations!;
			expect(migrations.applied["add-supervisor-local-template-v1"]).toBeDefined();
			expect(typeof migrations.applied["add-supervisor-local-template-v1"].appliedAt).toBe("string");
		});

		it("preserves existing taskplane.json fields when saving migration state", () => {
			setupProjectDir(tempDir);
			// Write existing taskplane.json with version tracker fields
			const existingMeta = {
				version: "0.15.0",
				installedAt: "2026-03-01T00:00:00.000Z",
				lastUpgraded: "2026-03-25T00:00:00.000Z",
				components: { agents: "0.15.0", config: "0.15.0" },
			};
			writeFileSync(
				join(tempDir, ".pi", "taskplane.json"),
				JSON.stringify(existingMeta, null, 2),
				"utf-8",
			);

			runMigrations(tempDir, packageRoot);

			// Existing fields should be preserved
			const meta = loadTaskplaneMeta(tempDir);
			expect(meta.version).toBe("0.15.0");
			expect(meta.installedAt).toBe("2026-03-01T00:00:00.000Z");
			expect(meta.lastUpgraded).toBe("2026-03-25T00:00:00.000Z");
			expect(meta.components).toEqual({ agents: "0.15.0", config: "0.15.0" });

			// Migrations field should be added
			expect(meta.migrations).toBeDefined();
			expect(meta.migrations!.applied["add-supervisor-local-template-v1"]).toBeDefined();
		});

		it("is idempotent — skips already-applied migrations on re-run", () => {
			setupProjectDir(tempDir);

			// First run
			const result1 = runMigrations(tempDir, packageRoot);
			expect(result1.applied.length).toBeGreaterThanOrEqual(1);

			// Second run — should skip all
			const result2 = runMigrations(tempDir, packageRoot);
			expect(result2.applied).toHaveLength(0);
			expect(result2.messages).toHaveLength(0);
			expect(result2.errors).toHaveLength(0);
			expect(result2.skipped.length).toBeGreaterThanOrEqual(1);
		});

		it("creates .pi directory if it does not exist", () => {
			// Don't call setupProjectDir — no .pi/ exists
			const result = runMigrations(tempDir, packageRoot);

			expect(result.errors).toHaveLength(0);
			expect(existsSync(join(tempDir, ".pi", "agents", "supervisor.md"))).toBe(true);
			expect(existsSync(join(tempDir, ".pi", "taskplane.json"))).toBe(true);
		});

		it("reports error when template source is missing", () => {
			setupProjectDir(tempDir);
			// Use a fake package root with no templates
			const fakePackageRoot = createTempDir();

			const result = runMigrations(tempDir, fakePackageRoot);

			// Should report an error (template missing throws)
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].error).toContain("template");

			// File not created (no template to copy)
			expect(existsSync(join(tempDir, ".pi", "agents", "supervisor.md"))).toBe(false);

			// Migration should NOT be marked as applied (will retry)
			const meta = loadTaskplaneMeta(tempDir);
			expect(meta.migrations?.applied["add-supervisor-local-template-v1"]).toBeUndefined();

			rmSync(fakePackageRoot, { recursive: true, force: true });
		});
	});

	describe("loadTaskplaneMeta", () => {
		it("returns empty object when file does not exist", () => {
			const meta = loadTaskplaneMeta(tempDir);
			expect(meta).toEqual({});
		});

		it("returns empty object for malformed JSON", () => {
			mkdirSync(join(tempDir, ".pi"), { recursive: true });
			writeFileSync(join(tempDir, ".pi", "taskplane.json"), "not json", "utf-8");

			const meta = loadTaskplaneMeta(tempDir);
			expect(meta).toEqual({});
		});

		it("returns parsed content for valid JSON", () => {
			mkdirSync(join(tempDir, ".pi"), { recursive: true });
			writeFileSync(
				join(tempDir, ".pi", "taskplane.json"),
				JSON.stringify({ version: "1.0.0", custom: true }),
				"utf-8",
			);

			const meta = loadTaskplaneMeta(tempDir);
			expect(meta).toEqual({ version: "1.0.0", custom: true });
		});

		it("returns empty object for array JSON", () => {
			mkdirSync(join(tempDir, ".pi"), { recursive: true });
			writeFileSync(join(tempDir, ".pi", "taskplane.json"), "[1,2,3]", "utf-8");

			const meta = loadTaskplaneMeta(tempDir);
			expect(meta).toEqual({});
		});
	});

	describe("saveTaskplaneMeta", () => {
		it("creates .pi directory and writes state to taskplane.json", () => {
			const meta: TaskplaneMeta = {
				migrations: {
					applied: { "test-m": { appliedAt: "2026-03-25T00:00:00.000Z" } },
				},
			};

			saveTaskplaneMeta(tempDir, meta);

			const filePath = join(tempDir, ".pi", "taskplane.json");
			expect(existsSync(filePath)).toBe(true);

			const loaded = JSON.parse(readFileSync(filePath, "utf-8"));
			expect(loaded.migrations.applied["test-m"].appliedAt).toBe("2026-03-25T00:00:00.000Z");
		});

		it("merges into existing taskplane.json without overwriting", () => {
			mkdirSync(join(tempDir, ".pi"), { recursive: true });
			writeFileSync(
				join(tempDir, ".pi", "taskplane.json"),
				JSON.stringify({ version: "0.15.0", installedAt: "2026-01-01" }, null, 2),
				"utf-8",
			);

			const meta: TaskplaneMeta = {
				migrations: {
					applied: { "test-m": { appliedAt: "2026-03-25T00:00:00.000Z" } },
				},
			};
			saveTaskplaneMeta(tempDir, meta);

			const loaded = JSON.parse(readFileSync(join(tempDir, ".pi", "taskplane.json"), "utf-8"));
			expect(loaded.version).toBe("0.15.0");
			expect(loaded.installedAt).toBe("2026-01-01");
			expect(loaded.migrations.applied["test-m"].appliedAt).toBe("2026-03-25T00:00:00.000Z");
		});
	});

	describe("MIGRATION_REGISTRY", () => {
		it("has at least one migration registered", () => {
			expect(MIGRATION_REGISTRY.length).toBeGreaterThanOrEqual(1);
		});

		it("has unique migration IDs", () => {
			const ids = MIGRATION_REGISTRY.map(m => m.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it("all migrations have required fields", () => {
			for (const m of MIGRATION_REGISTRY) {
				expect(m.id).toBeTruthy();
				expect(m.description).toBeTruthy();
				expect(typeof m.run).toBe("function");
			}
		});
	});
});
