import { dirname } from "node:path";
import type { HookFnMap, TransformHookFilter } from "unplugin";
import type { EntryRewriter } from "@/core";
import { cleanId, toTransformResult } from "../shared";

//----------------------
// Types
//----------------------

type RequestResolver = (context: string, request: string) => Promise<string>;

/** What the plugin uses from webpack / Rspack loader contexts. */
interface WebpackLikeLoaderContext {
	getResolve: (options?: { dependencyType?: string }) => RequestResolver;
	resourcePath: string;
}

/** What the plugin uses from webpack / Rspack compilers. */
interface WebpackLikeCompiler {
	context: string;
	options: { entry: unknown };
}

/** @internal */
export interface WebpackTransform {
	/** Forgets entries resolved in a previous compilation. */
	reset: () => void;
	transform: { filter: TransformHookFilter; handler: HookFnMap["transform"] };
}

//----------------------
// Helpers
//----------------------

/** Script module ids, with or without a query. */
// eslint-disable-next-line require-unicode-regexp -- also handed to bundlers as a native filter
const SCRIPT_ID = /\.[cm]?[jt]sx?(?:$|\?)/;

/** Request strings of the webpack / Rspack `entry` option (static, normalized or function). */
const listEntryRequests = async (entry: unknown): Promise<string[]> => {
	const value: unknown = typeof entry === "function" ? await (entry as () => Promise<unknown>)() : entry;
	const fromDescription = (description: unknown): string[] => {
		if (typeof description === "string") return [description];
		if (Array.isArray(description)) return description.filter((item): item is string => typeof item === "string");
		if (description && typeof description === "object" && "import" in description) {
			return fromDescription(description.import);
		}
		return [];
	};

	if (typeof value === "string" || Array.isArray(value)) return fromDescription(value);
	if (value && typeof value === "object") return Object.values(value).flatMap(item => fromDescription(item));
	return [];
};

/** Absolute paths of the webpack / Rspack entry modules. */
const resolveEntries = async (compiler: WebpackLikeCompiler, resolveRequest: RequestResolver): Promise<Set<string>> => {
	const requests = await listEntryRequests(compiler.options.entry);
	const resolved = await Promise.all(
		requests.map(async request => resolveRequest(compiler.context, request).catch(() => void 0))
	);
	return new Set(resolved.filter((path): path is string => path !== undefined).map(path => cleanId(path)));
};

//----------------------
// Transform
//----------------------

/**
 * unplugin `transform` for webpack and Rspack, where it runs as a loader (`enforce: "pre"`, before other loaders).
 * Entry modules come from the compiler's `entry` option, resolved with the loader's resolver.
 * @internal
 */
export const createWebpackTransform = (rewriter: EntryRewriter): WebpackTransform => {
	let entries: Promise<Set<string>> | undefined;

	return {
		reset() {
			entries = undefined;
		},
		transform: {
			filter: { id: { exclude: [/node_modules/u], include: [SCRIPT_ID] } },
			async handler(code) {
				const native = this.getNativeBuildContext?.();
				if (native?.framework !== "webpack" && native?.framework !== "rspack") return void 0;
				const loaderContext = native.loaderContext as WebpackLikeLoaderContext | undefined;
				if (!loaderContext) return void 0;

				const resolveRequest = loaderContext.getResolve({ dependencyType: "esm" });
				entries ??= resolveEntries(native.compiler as WebpackLikeCompiler, resolveRequest);

				const path = loaderContext.resourcePath;
				const entryPaths = await entries;
				if (!entryPaths.has(path)) return void 0;

				const result = await rewriter.rewrite(path, code, async (specifier, importer) => {
					const resolved = await resolveRequest(dirname(importer), specifier);
					return cleanId(resolved);
				});
				if (!result) return void 0;

				for (const file of result.watchFiles) this.addWatchFile(file);
				return toTransformResult(rewriter, path, result, message => {
					this.warn(message);
				});
			}
		}
	};
};
