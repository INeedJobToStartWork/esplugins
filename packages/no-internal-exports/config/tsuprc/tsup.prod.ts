import config from "./tsup.base";
import { copy } from "esbuild-plugin-copy";
import { build, defineConfig } from "tsup";

export default defineConfig({
	...config,

	bundle: true,
	splitting: true,
	minify: true,
	shims: true,
	sourcemap: false,

	minifyIdentifiers: true,
	minifySyntax: true,
	minifyWhitespace: true,

	metafile: false,
	treeshake: true,
	external: ["oh-my-error"],
	esbuildOptions(options, context) {
		options.drop = ["console"];
	},
	outDir: "dist",

	format: ["esm", "cjs"],

	esbuildPlugins: [
		copy({
			assets: [
				{ from: "./package.json", to: "./package.json" },
				{ from: "./.npmrc", to: "./.npmrc" },
				{ from: "./.npmignore", to: "./.npmignore" },
				{ from: "./README.md", to: "./README.md" },
				{ from: "./LICENSE", to: "./" }
			]
		})
	]
	// external: ['eslint'],
});
