import { noInternalExportsUnplugin } from "@/adapters/unplugin/factory";

//----------------------
// Plugin
//----------------------

/**
 * `no-internal-exports` plugin for Rspack.
 *
 * @example
 * import noInternalExports from "@esplugins/no-internal-exports/rspack";
 *
 * noInternalExports({ tags: ["internal", "dontexport"] });
 */
export const noInternalExportsRspack = noInternalExportsUnplugin.rspack;

export default noInternalExportsRspack;

export type { NoInternalExportsOptions } from "@/core";
