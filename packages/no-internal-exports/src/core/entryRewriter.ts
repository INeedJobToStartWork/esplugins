import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { ExportGraph } from "./exportGraph";
import { createModuleRecord, parseSource } from "./parseModule";
import type { RewriteResult } from "./rewriteEntry";
import { rewriteEntry } from "./rewriteEntry";
import { createTagMatcher, DEFAULT_TAGS } from "./tags";
import type { ModuleLoader, ModuleRecord } from "./types";

//----------------------
// Types
//----------------------

/**
 * Options shared by every bundler adapter.
 */
export interface NoInternalExportsOptions {
	/**
	 * Print which exports were removed from each entry file.
	 * @default false
	 */
	debug?: boolean;
	/**
	 * JSDoc tags (without `@`) that mark declarations which must not be exported from entry files.
	 * @default ["internal", "dontexport"]
	 */
	tags?: readonly string[];
}

/**
 * Bundler resolver: absolute path of `specifier` imported from `importer`, or `undefined` if it can't be analyzed.
 * @internal
 */
export type PathResolver = (specifier: string, importer: string) => Promise<string | undefined>;

/** @internal */
export interface EntryRewrite extends RewriteResult {
	/** Every module analyzed for this entry: changing a tag there must rebuild the entry. */
	watchFiles: string[];
}

/** @internal */
export interface EntryRewriter {
	/** Logs removed exports when `options.debug` is enabled. */
	log: (path: string, removed: string[]) => void;
	/** Clears per-build caches. Call it when a (re)build starts. */
	reset: () => void;
	/** Rewrites the entry file `path` whose current source is `code`. `undefined` if it can't be parsed. */
	rewrite: (path: string, code: string, resolve: PathResolver) => Promise<EntryRewrite | undefined>;
}

//----------------------
// Constants
//----------------------

/** @internal */
export const PLUGIN_NAME = "no-internal-exports";

/**
 * Files that can be analyzed. No `u` flag: esbuild filters must be valid Go regular expressions.
 * @internal
 */
// eslint-disable-next-line require-unicode-regexp
export const SCRIPT_FILTER = /\.[cm]?[jt]sx?$/;

//----------------------
// Functions
//----------------------

/**
 * Creates the bundler-independent part of the plugin: parsing, export graph and entry rewriting.
 * @internal
 */
export const createEntryRewriter = (options: NoInternalExportsOptions = {}): EntryRewriter => {
	const isTag = createTagMatcher(options.tags ?? DEFAULT_TAGS);
	let records = new Map<string, Promise<ModuleRecord | undefined>>();
	let resolutions = new Map<string, Promise<string | undefined>>();

	const readRecord = async (path: string) => {
		let record = records.get(path);
		if (!record) {
			record = readFile(path, "utf8").then(
				source => {
					const parsed = parseSource(path, source);
					return parsed && createModuleRecord(path, parsed, isTag);
				},
				() => void 0 // not a real file (virtual module)
			);
			records.set(path, record);
		}
		return record;
	};

	return {
		log(path, removed) {
			if (!options.debug) return;
			const list = removed.length > 0 ? removed.join(", ") : "(none)";
			console.info(`[${PLUGIN_NAME}] ${relative(process.cwd(), path)}: removed internal exports: ${list}`);
		},

		reset() {
			records = new Map();
			resolutions = new Map();
		},

		async rewrite(path, code, resolve) {
			const parsed = parseSource(path, code);
			if (!parsed) return void 0; // syntax error: let the bundler report it

			const watchFiles = new Set<string>();
			const load: ModuleLoader = async (specifier, importer) => {
				const key = `${dirname(importer)}\0${specifier}`;
				let resolved = resolutions.get(key);
				if (!resolved) {
					resolved = resolve(specifier, importer).then(
						result => (result && isAbsolute(result) && SCRIPT_FILTER.test(result) ? result : void 0),
						() => void 0
					);
					resolutions.set(key, resolved);
				}

				const target = await resolved;
				if (!target) return void 0;
				watchFiles.add(target);
				return readRecord(target);
			};

			const record = createModuleRecord(path, parsed, isTag);
			const result = await rewriteEntry(new ExportGraph(load), record, parsed);
			// eslint-disable-next-line @EslintUnicorn/prefer-spread -- conflicts with @EslintPrefArrayFunc/prefer-array-from
			return { ...result, watchFiles: Array.from(watchFiles) };
		}
	};
};
