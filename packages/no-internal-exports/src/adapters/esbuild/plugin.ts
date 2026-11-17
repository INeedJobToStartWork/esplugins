import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Plugin } from "esbuild";
import type { NoInternalExportsOptions } from "@/core";
import { createEntryRewriter, PLUGIN_NAME, SCRIPT_FILTER } from "@/core";
import { getScriptLoader, listEntryPoints, resolveEntryPoint } from "./entryPoints";

//----------------------
// Types
//----------------------

export type { NoInternalExportsOptions } from "@/core";

//----------------------
// Plugin
//----------------------

/**
 * Creates the `no-internal-exports` esbuild plugin.
 *
 * Exports whose declaration has an `internal` / `dontexport` JSDoc tag (or one of `options.tags`)
 * are removed from entry files, including those reached through `export *` and re-export chains.
 * (Don't write the tag itself here: TypeScript's `stripInternal` would drop this declaration.)
 * Other modules keep exporting them, so they stay usable across the codebase and in tests.
 *
 * @example
 * import { createNoInternalExports } from "@esplugins/no-internal-exports";
 *
 * await esbuild.build({
 * 	entryPoints: ["src/index.ts"],
 * 	plugins: [createNoInternalExports({ tags: ["internal", "private"] })]
 * });
 */
export const createNoInternalExports = (options: NoInternalExportsOptions = {}): Plugin => ({
	name: PLUGIN_NAME,
	setup(build) {
		const entries = listEntryPoints(build.initialOptions.entryPoints);
		if (entries.length === 0) return; // e.g. `stdin` builds: no entry file to protect

		const workingDir = build.initialOptions.absWorkingDir ?? process.cwd();
		const entryPaths = new Set<string>();
		const rewriter = createEntryRewriter(options);

		build.onStart(async () => {
			rewriter.reset(); // so watch mode and `rebuild()` see file changes
			entryPaths.clear();
			const paths = await Promise.all(entries.map(async entry => resolveEntryPoint(build, entry, workingDir)));
			for (const path of paths) if (path) entryPaths.add(path);
		});

		build.onLoad({ filter: SCRIPT_FILTER }, async args => {
			if (args.namespace !== "file" || !entryPaths.has(args.path)) return void 0;

			const loader = getScriptLoader(args.path, build.initialOptions.loader);
			if (!loader) return void 0;

			const source = await readFile(args.path, "utf8");
			const result = await rewriter.rewrite(args.path, source, async (specifier, importer) => {
				const resolved = await build.resolve(specifier, {
					importer,
					kind: "import-statement",
					resolveDir: dirname(importer)
				});
				const usable = resolved.errors.length === 0 && !resolved.external && resolved.namespace === "file";
				return usable ? resolved.path : void 0;
			});
			if (!result) return void 0;

			rewriter.log(args.path, result.removed);
			// Returned even when unchanged: `watchFiles` makes esbuild rebuild the entry when a tag changes elsewhere.
			return {
				contents: result.code,
				loader,
				resolveDir: dirname(args.path),
				watchFiles: result.watchFiles,
				warnings: result.warnings.map(text => ({ text }))
			};
		});
	}
});

/**
 * Ready-to-use `no-internal-exports` esbuild plugin with default options.
 *
 * @example
 * import noInternalExports from "@esplugins/no-internal-exports";
 *
 * await esbuild.build({ entryPoints: ["src/index.ts"], plugins: [noInternalExports] });
 */
export const noInternalExports: Plugin = createNoInternalExports();

export default noInternalExports;
