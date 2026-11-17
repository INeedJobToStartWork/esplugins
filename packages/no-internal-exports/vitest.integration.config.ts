import { defineConfig } from "vitest/config";

/**
 * Integration tests of the built package (`pnpm test:integration`): packs `dist/`, installs it into a project
 * outside the monorepo and runs real builds through every entry, as ESM and CJS.
 */
export default defineConfig({
	test: {
		include: ["tests/integration/**/*.test.ts"],
		globalSetup: ["tests/integration/setup.ts"],
		testTimeout: 120_000,
		hookTimeout: 600_000
	}
});
