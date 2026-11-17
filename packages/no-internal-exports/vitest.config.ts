import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		passWithNoTests: true,
		// Integration tests need a build: they run with `pnpm test:integration` (vitest.integration.config.ts).
		exclude: [...configDefaults.exclude, "tests/integration/**"]
	},
	resolve: {
		alias: {
			"@": resolve(import.meta.dirname, "src/")
		}
	}
});
