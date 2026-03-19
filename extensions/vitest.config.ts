import { defineConfig } from "vitest/config";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { Plugin } from "vite";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Strip shebang lines (#!/...) from .mjs files so Vitest's inline
 * module evaluator (vm.runInThisContext) doesn't choke on them.
 */
function stripShebang(): Plugin {
	return {
		name: "strip-shebang",
		transform(code, id) {
			if (id.endsWith(".mjs") && code.startsWith("#!")) {
				return code.replace(/^#![^\n]*\n/, "\n");
			}
		},
	};
}

export default defineConfig({
	plugins: [stripShebang()],
	resolve: {
		alias: {
			"@mariozechner/pi-coding-agent": resolve(__dirname, "tests/mocks/pi-coding-agent.ts"),
			"@mariozechner/pi-tui": resolve(__dirname, "tests/mocks/pi-tui.ts"),
		},
	},
	test: {
		include: ["tests/**/*.test.ts"],
		testTimeout: 60_000,
	},
});
