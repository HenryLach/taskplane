/**
 * Regression guard for issue #560: Pi was renamed from
 * `@mariozechner/pi-coding-agent` to `@earendil-works/pi-coding-agent`
 * in Pi v0.74.0. The hardcoded `@mariozechner` reference in
 * `resolvePiCliPath()` made every Runtime V2 spawn fail with
 * "Cannot find Pi CLI entrypoint" on systems with only the new scope.
 *
 * The fix searches both scopes (new first, legacy fallback). These
 * tests verify:
 *
 *   1. Resolution succeeds when ONLY `@earendil-works` is installed
 *      (the failure mode #560 actually hit).
 *   2. Resolution still succeeds when ONLY `@mariozechner` is installed
 *      (backward compat for legacy installs).
 *   3. Resolution prefers `@earendil-works` when both are present
 *      (transition window — operator just upgraded but legacy hasn't
 *      been pruned).
 *   4. The error message names BOTH scopes when neither is found, so
 *      operators get a clear pointer regardless of which install command
 *      they previously ran.
 *
 * Strategy: each test creates a temp directory laid out like an npm
 * global root (`<tmp>/<scope>/pi-coding-agent/dist/cli.js`), points
 * `getNpmGlobalRoot()` at the temp dir via a child-process probe, and
 * inspects the resolved path. We use a child probe (rather than
 * mocking `npm root -g` in-process) because `getNpmGlobalRoot()`
 * caches its result at module level on first call \u2014 hard to reset
 * within a single test run.
 *
 * The child probe sets `npm_config_prefix` env var, which `npm root -g`
 * honors. That redirects npm's global root computation to our temp
 * directory without needing to mock `child_process.execSync`.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

/**
 * Set up a temp directory containing the requested Pi scopes, return the
 * temp directory path. Caller is responsible for cleanup via `rmSync`.
 *
 * Layout for each scope: `<tmp>/lib/node_modules/<scope>/pi-coding-agent/dist/cli.js`
 *
 * (`lib/node_modules` matches what `npm root -g` produces under
 * `npm_config_prefix=<tmp>` on Linux/macOS; on Windows it's just
 * `<tmp>/node_modules` but mkdir-p handles either layout the same way.)
 */
function makeNpmRootWithScopes(scopes: ReadonlyArray<"@earendil-works" | "@mariozechner">): {
	tmpDir: string;
	npmRootDir: string;
	cleanup: () => void;
} {
	const tmpDir = mkdtempSync(join(tmpdir(), "tp560-pi-scope-"));
	// Mirror npm's global-prefix layout. On POSIX: <prefix>/lib/node_modules.
	// On Windows: <prefix>/node_modules. We create both so the test is
	// platform-agnostic and the resolver finds it under either npm root
	// reporting convention.
	const posixRoot = join(tmpDir, "lib", "node_modules");
	const winRoot = join(tmpDir, "node_modules");
	mkdirSync(posixRoot, { recursive: true });
	mkdirSync(winRoot, { recursive: true });
	for (const root of [posixRoot, winRoot]) {
		for (const scope of scopes) {
			const distDir = join(root, scope, "pi-coding-agent", "dist");
			mkdirSync(distDir, { recursive: true });
			writeFileSync(join(distDir, "cli.js"), "// fake pi cli for #560 regression test\n", "utf-8");
		}
	}
	const npmRootDir = process.platform === "win32" ? winRoot : posixRoot;
	return { tmpDir, npmRootDir, cleanup: () => rmSync(tmpDir, { recursive: true, force: true }) };
}

/**
 * Run a child Node process that imports `path-resolver.ts` with the given
 * `npm_config_prefix` redirecting `npm root -g`. Returns the resolved path
 * or throws (capturing stderr) so test assertions can match either outcome.
 */
// TP-195: `stderr?: undefined` on success branch makes the discriminated
// union narrowable under `strict: false` (the codebase-wide convention
// applied here for the same reason as engine.ts:processSegmentExpansion
// and persistence.ts:ReconstructResult).
function probeResolveInChild(
	npmConfigPrefix: string | null,
): { ok: true; resolved: string; stderr?: undefined } | { ok: false; stderr: string } {
	const probeScript = `
		import("${pathToFileUrl(join(repoRoot, "taskplane", "path-resolver.ts"))}").then((m) => {
			try {
				const resolved = m.resolvePiCliPath();
				process.stdout.write("OK::" + resolved);
			} catch (err) {
				process.stderr.write("ERR::" + (err && err.message ? err.message : String(err)));
				process.exit(1);
			}
		});
	`;
	const env: NodeJS.ProcessEnv = { ...process.env };
	if (npmConfigPrefix) {
		env.npm_config_prefix = npmConfigPrefix;
		// Belt and suspenders: also clear any cached parent inherited values.
		delete env.NPM_CONFIG_PREFIX;
		env.NPM_CONFIG_PREFIX = npmConfigPrefix;
	}
	try {
		const out = execFileSync(
			process.execPath,
			["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", probeScript],
			{ env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
		).toString();
		const m = out.match(/^OK::(.*)$/s);
		if (m) return { ok: true, resolved: m[1].trim() };
		return { ok: false, stderr: `unexpected stdout: ${out}` };
	} catch (err: unknown) {
		const e = err as { stderr?: Buffer | string };
		const stderr = (e.stderr ?? "").toString();
		const m = stderr.match(/ERR::(.*)/s);
		return { ok: false, stderr: m ? m[1].trim() : stderr };
	}
}

/** Convert an absolute path to a `file:///...` URL for dynamic import in the probe. */
function pathToFileUrl(absPath: string): string {
	const normalized = absPath.replace(/\\/g, "/");
	return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

describe("resolvePiCliPath — Pi scope rename (#560)", () => {
	it("8.4 (#560): resolves under @earendil-works/pi-coding-agent (current scope)", () => {
		const { tmpDir, cleanup } = makeNpmRootWithScopes(["@earendil-works"]);
		try {
			const result = probeResolveInChild(tmpDir);
			assert.ok(result.ok, `expected resolution to succeed, got: ${result.ok ? "OK" : result.stderr}`);
			if (result.ok) {
				assert.match(
					result.resolved,
					/[\\/]@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]cli\.js$/,
					`expected resolved path under @earendil-works, got: ${result.resolved}`,
				);
			}
		} finally {
			cleanup();
		}
	});

	it("8.5 (#560): resolves under @mariozechner/pi-coding-agent (legacy scope, backward compat)", () => {
		const { tmpDir, cleanup } = makeNpmRootWithScopes(["@mariozechner"]);
		try {
			const result = probeResolveInChild(tmpDir);
			assert.ok(result.ok, `expected resolution to succeed, got: ${result.ok ? "OK" : result.stderr}`);
			if (result.ok) {
				assert.match(
					result.resolved,
					/[\\/]@mariozechner[\\/]pi-coding-agent[\\/]dist[\\/]cli\.js$/,
					`expected resolved path under @mariozechner, got: ${result.resolved}`,
				);
			}
		} finally {
			cleanup();
		}
	});

	it("8.6 (#560): prefers @earendil-works when BOTH scopes are present (new-first ordering)", () => {
		const { tmpDir, cleanup } = makeNpmRootWithScopes(["@earendil-works", "@mariozechner"]);
		try {
			const result = probeResolveInChild(tmpDir);
			assert.ok(result.ok, `expected resolution to succeed, got: ${result.ok ? "OK" : result.stderr}`);
			if (result.ok) {
				assert.match(
					result.resolved,
					/[\\/]@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]cli\.js$/,
					"with both scopes installed, the resolver must prefer @earendil-works (current scope wins)",
				);
				assert.ok(
					!/@mariozechner/.test(result.resolved),
					`resolver picked @mariozechner over @earendil-works \u2014 ordering regression: ${result.resolved}`,
				);
			}
		} finally {
			cleanup();
		}
	});

	it("8.7 (#560): error message names BOTH scopes when neither is found", () => {
		// Empty npm root \u2014 no Pi installed under any scope.
		const tmpDir = mkdtempSync(join(tmpdir(), "tp560-empty-"));
		try {
			// Create the directory structure but no Pi packages. This forces the
			// resolver to exhaust all candidates and throw.
			mkdirSync(join(tmpDir, "lib", "node_modules"), { recursive: true });
			mkdirSync(join(tmpDir, "node_modules"), { recursive: true });
			const result = probeResolveInChild(tmpDir);
			// The resolver may still find Pi via OTHER candidate locations
			// (the test's npm_config_prefix only affects `npm root -g`, not the
			// other static fallback paths like /usr/local/lib/...). On a
			// developer machine those other paths may have Pi installed. Skip
			// the negative assertion if resolution succeeded \u2014 we can't
			// guarantee a clean negative on a real dev box.
			if (result.ok) {
				return; // graceful skip: real Pi found via fallback paths
			}
			assert.match(
				result.stderr,
				/@earendil-works/,
				"error message must name @earendil-works (current scope)",
			);
			assert.match(
				result.stderr,
				/@mariozechner/,
				"error message must name @mariozechner (legacy scope) so operators on legacy installs get a clear pointer",
			);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
