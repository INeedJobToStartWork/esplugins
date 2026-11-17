import { extname, isAbsolute } from "node:path";
import type { BuildOptions, Loader, PluginBuild } from "esbuild";

//----------------------
// Constants
//----------------------

const DEFAULT_LOADERS: Partial<Record<string, Loader>> = {
	".js": "js",
	".mjs": "js",
	".cjs": "js",
	".jsx": "jsx",
	".ts": "ts",
	".mts": "ts",
	".cts": "ts",
	".tsx": "tsx"
};

const SCRIPT_LOADERS = new Set<Loader>(["js", "jsx", "ts", "tsx"]);

//----------------------
// Functions
//----------------------

/**
 * Entry point paths as written in the build options (all supported `entryPoints` shapes).
 * @internal
 */
export const listEntryPoints = (entryPoints: BuildOptions["entryPoints"]): string[] => {
	if (!entryPoints) return [];
	if (!Array.isArray(entryPoints)) return Object.values(entryPoints);
	return entryPoints.map(entry => (typeof entry === "string" ? entry : entry.in));
};

/**
 * Resolves an entry point to an absolute file path, the way esbuild does (path first, then package).
 * @internal
 */
export const resolveEntryPoint = async (
	build: PluginBuild,
	entry: string,
	resolveDir: string
): Promise<string | undefined> => {
	const candidates = isAbsolute(entry) || entry.startsWith(".") ? [entry] : [`./${entry}`, entry];

	for (const candidate of candidates) {
		// eslint-disable-next-line no-await-in-loop -- candidates are tried in order, first match wins
		const result = await build.resolve(candidate, { kind: "entry-point", resolveDir });
		if (result.errors.length === 0 && !result.external && result.namespace === "file") return result.path;
	}
	return void 0;
};

/**
 * Loader esbuild would use for the file, if it is a script.
 * @internal
 */
export const getScriptLoader = (path: string, loaders: BuildOptions["loader"]): Loader | undefined => {
	const extension = extname(path);
	const loader = loaders?.[extension] ?? DEFAULT_LOADERS[extension];
	return loader && SCRIPT_LOADERS.has(loader) ? loader : void 0;
};
