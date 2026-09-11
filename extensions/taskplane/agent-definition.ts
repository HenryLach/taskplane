/** Shared agent prompt loading for the orchestrator and agent-side bridge. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveTaskplaneAgentTemplate } from "./path-resolver.ts";
import { resolvePointer, loadWorkspaceConfig } from "./workspace.ts";

/**
 * Parse an agent .md file: extract frontmatter and body.
 * Returns null if file doesn't exist or is malformed.
 * @since TP-117
 */
function parseAgentFile(filePath: string): { fm: Record<string, string>; body: string } | null {
	try {
		if (!existsSync(filePath)) return null;
		const raw = readFileSync(filePath, "utf-8");
		const fmEnd = raw.indexOf("---", 4);
		if (fmEnd < 0) return { fm: {}, body: raw.trim() };
		const fmBlock = raw.slice(4, fmEnd).trim();
		const fm: Record<string, string> = {};
		for (const line of fmBlock.split("\n")) {
			const m = line.match(/^([\w-]+)\s*:\s*(.+)/);
			if (m) fm[m[1]] = m[2].trim();
		}
		return { fm, body: raw.slice(fmEnd + 3).trim() };
	} catch {
		return null;
	}
}

/**
 * Load the base agent prompt from the taskplane package's templates/ directory.
 * Resolves the running package root, with npm global paths as fallbacks.
 * @since TP-117
 */
export function loadBaseAgentPrompt(agentName: string): string {
	// resolveTaskplaneAgentTemplate handles all npm setups (nvm, Homebrew, volta, Windows, etc.)
	// via npm root -g caching and well-known fallback paths (see path-resolver.ts, TP-157).
	// This avoids silently returning "" which would cause the worker to skip reviews.
	try {
		const resolved = resolveTaskplaneAgentTemplate(agentName);
		if (existsSync(resolved)) {
			const def = parseAgentFile(resolved);
			if (def?.body) return def.body;
		}
	} catch {
		/* fall through */
	}
	return "";
}

// ── Agent Definition Loading ─────────────────────────────────────────

/** Track whether an agent pointer warning has been logged this session (log once). */
let _execPointerWarningLogged = false;

/**
 * Reset agent pointer warning state for testing.
 * @since TP-161
 */
export function resetPointerWarning(): void {
	_execPointerWarningLogged = false;
}

/**
 * Resolve agent files using the workspace pointer (workspace mode only).
 * Returns the agentRoot from the pointer, or null in repo mode / on failure.
 */
function resolveAgentPointerRoot(): string | null {
	const wsRoot = process.env.TASKPLANE_WORKSPACE_ROOT;
	if (!wsRoot) return null;
	try {
		const wsConfig = loadWorkspaceConfig(wsRoot);
		const result = resolvePointer(wsRoot, wsConfig);
		if (result?.warning && !_execPointerWarningLogged) {
			_execPointerWarningLogged = true;
			console.error(`[execution] pointer: ${result.warning}`);
		}
		return result?.agentRoot ?? null;
	} catch {
		return null;
	}
}

/**
 * Load a complete agent definition (systemPrompt + tools + model) by name.
 *
 * Resolution order:
 *   0. preferredAgentRoot/<name>.md (when supplied)
 *   1. cwd/.pi/agents/<name>.md
 *   2. cwd/agents/<name>.md
 *   3. pointer.agentRoot/<name>.md (workspace mode only)
 *   4. Base package templates/agents/<name>.md
 *
 * If a local file has `standalone: true` in frontmatter, it is used as-is
 * (no base composition). Otherwise, base + local are composed.
 *
 * @param cwd - Working directory (project root) to search for local agent files
 * @param name - Agent name (e.g., "task-worker", "task-reviewer")
 * @param preferredAgentRoot - Explicit agent directory to search before project paths
 * @returns Composed agent definition, or null if no base and no local file found
 * @since TP-161
 */
export function loadAgentDef(
	cwd: string,
	name: string,
	preferredAgentRoot?: string,
): { systemPrompt: string; tools: string; model: string } | null {
	const localPaths = [join(cwd, ".pi", "agents", `${name}.md`), join(cwd, "agents", `${name}.md`)];

	// An explicitly resolved agent root retains precedence for merge agents.
	if (preferredAgentRoot) localPaths.unshift(join(preferredAgentRoot, `${name}.md`));

	// In workspace mode, add pointer-resolved agent root as fallback
	const agentRoot = resolveAgentPointerRoot();
	if (agentRoot) {
		localPaths.push(join(agentRoot, `${name}.md`));
	}

	// Load base from package
	let baseDef: { fm: Record<string, string>; body: string } | null = null;
	try {
		const basePath = resolveTaskplaneAgentTemplate(name);
		if (existsSync(basePath)) {
			baseDef = parseAgentFile(basePath);
		}
	} catch {
		/* fall through */
	}

	// Load local override (first found wins)
	let localDef: { fm: Record<string, string>; body: string } | null = null;
	for (const p of localPaths) {
		localDef = parseAgentFile(p);
		if (localDef) break;
	}

	// No base and no local → null
	if (!baseDef && !localDef) return null;

	// Local with standalone: true → use local as-is, ignore base
	if (localDef?.fm.standalone === "true") {
		return {
			systemPrompt: localDef.body,
			tools: localDef.fm.tools || "read,grep,find,ls",
			model: localDef.fm.model || "",
		};
	}

	// Compose base + local
	const basePrompt = baseDef?.body || "";
	const localPrompt = localDef?.body || "";
	const composedPrompt = localPrompt
		? basePrompt + "\n\n---\n\n## Project-Specific Guidance\n\n" + localPrompt
		: basePrompt;

	// Local frontmatter overrides base (tools, model)
	const tools = localDef?.fm.tools || baseDef?.fm.tools || "read,grep,find,ls";
	const model = localDef?.fm.model || baseDef?.fm.model || "";

	return { systemPrompt: composedPrompt.trim(), tools, model };
}
