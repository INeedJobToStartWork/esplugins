import type { EntryRewriter, PathResolver } from "@/core";
import type { TransformOutput } from "../shared";
import { cleanId, isScriptModule, toTransformResult } from "../shared";

//----------------------
// Types
//----------------------

/* eslint-disable @EslintUnicorn/no-null -- mirrors Rollup's plugin context API */
/** What the plugin uses from the Rollup / Vite / Rolldown plugin context. */
interface RollupLikeContext {
	addWatchFile: (id: string) => void;
	getModuleInfo: (id: string) => { isEntry: boolean } | null;
	resolve: (
		source: string,
		importer?: string,
		options?: { skipSelf?: boolean }
	) => Promise<{ external: boolean | string; id: string } | null>;
	warn: (message: string) => void;
}
/* eslint-enable @EslintUnicorn/no-null */

/** @internal */
export interface RollupHooks {
	buildStart: () => void;
	transform: (this: RollupLikeContext, code: string, id: string) => Promise<TransformOutput | undefined>;
}

//----------------------
// Hooks
//----------------------

/**
 * Native hooks for Rollup-compatible bundlers (Rollup, Vite, Rolldown / tsdown).
 * Their plugin context exposes module info (`isEntry`) and the bundler's resolver, which unplugin's unified
 * context doesn't, so these hooks replace the unified ones for those bundlers.
 * @internal
 */
export const createRollupHooks = (rewriter: EntryRewriter): RollupHooks => ({
	buildStart() {
		rewriter.reset();
	},
	async transform(this: RollupLikeContext, code: string, id: string) {
		if (!isScriptModule(id) || this.getModuleInfo(id)?.isEntry !== true) return void 0;

		const path = cleanId(id);
		const resolve: PathResolver = async (specifier, importer) => {
			const resolved = await this.resolve(specifier, importer, { skipSelf: true });
			return resolved && resolved.external === false ? cleanId(resolved.id) : void 0;
		};
		const result = await rewriter.rewrite(path, code, resolve);
		if (!result) return void 0;

		for (const file of result.watchFiles) this.addWatchFile(file);
		return toTransformResult(rewriter, path, result, message => {
			this.warn(message);
		});
	}
});
