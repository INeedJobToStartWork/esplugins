import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	target: "es2022",
	format: ["esm"],
	clean: true,
	splitting: false,
	platform: "node",
	keepNames: true,

	dts: false,
	tsconfig: "./tsconfig.json",

	external: ["node:path", "node:fs", "typescript"],

	banner: ({ format }) => {
		if (format === "esm") {
			const banner = `
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
      `;

			return { js: banner };
		}
	}
});
