import { noInternalExportsUnplugin } from "@/adapters/unplugin/factory";

//----------------------
// Plugin
//----------------------

/**
 * `no-internal-exports` plugin for Rollup.
 *
 * @example
 * import noInternalExports from "@esplugins/no-internal-exports/rollup";
 *
 * noInternalExports({ tags: ["internal", "dontexport"] });
 */
export const noInternalExportsRollup = noInternalExportsUnplugin.rollup;

export default noInternalExportsRollup;

export type { NoInternalExportsOptions } from "@/core";
