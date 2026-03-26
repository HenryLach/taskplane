/**
 * Module-resolution hooks for the Node.js customization API.
 *
 * Redirects pi-package specifiers to local mock files so tests don't need
 * the real packages installed.
 *
 * This file is loaded inside the hooks thread by `module.register()`.
 * See loader.mjs for the entry point.
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const aliases = {
	"@mariozechner/pi-coding-agent": pathToFileURL(
		resolvePath(__dirname, "mocks", "pi-coding-agent.ts"),
	).href,
	"@mariozechner/pi-tui": pathToFileURL(
		resolvePath(__dirname, "mocks", "pi-tui.ts"),
	).href,
};

/**
 * Node.js resolve hook.
 * https://nodejs.org/api/module.html#resolvespecifier-context-nextresolve
 */
export async function resolve(specifier, context, nextResolve) {
	if (specifier in aliases) {
		return nextResolve(aliases[specifier], context);
	}
	return nextResolve(specifier, context);
}
