import { noInternalExportsUnplugin } from "@/adapters/unplugin/factory";

//----------------------
// Plugin
//----------------------

/**
 * `no-internal-exports` plugin for Webpack.
 *
 * @example
 * import noInternalExports from "@esplugins/no-internal-exports/webpack";
 *
 * noInternalExports({ tags: ["internal", "dontexport"] });
 */
export const noInternalExportsWebpack = noInternalExportsUnplugin.webpack;

export default noInternalExportsWebpack;

export type { NoInternalExportsOptions } from "@/core";
