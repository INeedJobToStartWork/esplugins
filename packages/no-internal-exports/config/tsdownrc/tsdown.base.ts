import { UserConfig } from "tsdown";
import { addNodeRequireShim, BuildMode, PROD_OPTIMIZE } from "./internals";

//----------------------
// Functions
//----------------------

const ENTRIES = ["index", "unplugin", "vite", "rollup", "rolldown", "webpack", "rspack"] as const;

/** @internal */
export const BasicConfig = (mode: BuildMode) =>
	({
		PACKAGE: {
			// `src/entries/*` = public entry points: `index` = esbuild plugin, one per bundler adapter (`@esplugins/no-internal-exports/vite`, ...).
			// Keep in sync with `exports` in clean-package.config.json.
			entry: Object.fromEntries(ENTRIES.map(name => [name, `${process.cwd()}/src/entries/${name}.ts`])),
			outDir: `${process.cwd()}/dist`,

			clean: true,
			// Bundlers are only referenced by types (adapters' return types). They are devDependencies, so
			// without this the `.d.ts` bundler would try to inline webpack / vite / postcss type definitions.
			deps: { neverBundle: [/^(?:esbuild|vite|rollup|rolldown|webpack|unplugin|@rspack\/core)(?:\/|$)/u] },
			target: "es2020",
			banner: addNodeRequireShim,
			dts: true,
			format: mode === BuildMode.DEV ? ["esm"] : ["esm", "cjs"],
			// Named + default exports: CJS consumers use `require(...).noInternalExports` or `.default`.
			outputOptions: { exports: "named" },

			// tsdown's `copy` runs once after all formats are built. A copy plugin would run once per
			// format (esm + cjs) in parallel and race on the same files (EBUSY on Windows).
			copy: ["package.json", ".npmrc", ".npmignore", "README.md", "LICENSE"].map(file => `${process.cwd()}/${file}`),
			// attw: !isDev,
			attw: mode === BuildMode.NPM,
			publint: mode === BuildMode.NPM,

			...(mode === BuildMode.DEV ? {} : PROD_OPTIMIZE)
		}
	}) as const satisfies Record<string, UserConfig>;

//----------------------
// CONSTANTS
//----------------------

/** @internal */
export const DEV_CONFIGS = BasicConfig(BuildMode.DEV);

/** @internal */
export const PROD_CONFIGS = BasicConfig(BuildMode.PROD);

/** @internal */
export const TEST_CONFIGS = BasicConfig(BuildMode.TEST);

/** @internal */
export const NPM_CONFIGS = BasicConfig(BuildMode.NPM);
