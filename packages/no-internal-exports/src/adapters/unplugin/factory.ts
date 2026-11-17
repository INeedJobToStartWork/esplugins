import type { UnpluginFactory, UnpluginInstance } from "unplugin";
import { createUnplugin } from "unplugin";
import type { NoInternalExportsOptions } from "@/core";
import { createEntryRewriter, PLUGIN_NAME } from "@/core";
import { createRollupHooks } from "../rollup/hooks";
import { createWebpackTransform } from "../webpack/transform";

//----------------------
// Factory
//----------------------

/**
 * unplugin factory of `no-internal-exports` (Vite, Rollup, Rolldown, webpack, Rspack, ...).
 *
 * Entry modules are detected from the bundler (`isEntry` module info, or the `entry` option for webpack / Rspack)
 * and transformed before other plugins (`enforce: "pre"`), using the bundler's own resolver.
 */
export const unpluginFactory: UnpluginFactory<NoInternalExportsOptions | undefined, false> = (options = {}) => {
	const rewriter = createEntryRewriter(options);
	const webpack = createWebpackTransform(rewriter);
	const rollupHooks = createRollupHooks(rewriter);

	return {
		name: PLUGIN_NAME,
		enforce: "pre",
		buildStart() {
			rewriter.reset();
			webpack.reset();
		},
		// Unified hook: used by webpack / Rspack. Rollup-compatible bundlers get native hooks below,
		// which unplugin applies over the unified ones.
		transform: webpack.transform,
		rollup: rollupHooks,
		rolldown: rollupHooks,
		// Entry files only matter for builds; the dev server has no library entry to protect.
		vite: { ...rollupHooks, apply: "build" }
	};
};

/**
 * `no-internal-exports` for every bundler supported by unplugin (`.vite()`, `.rollup()`, `.rolldown()`,
 * `.webpack()`, `.rspack()`, ...).
 */
export const noInternalExportsUnplugin: UnpluginInstance<NoInternalExportsOptions | undefined, false> =
	createUnplugin(unpluginFactory);
