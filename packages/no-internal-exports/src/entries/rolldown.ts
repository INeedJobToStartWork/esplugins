import { noInternalExportsUnplugin } from "@/adapters/unplugin/factory";

//----------------------
// Plugin
//----------------------

/**
 * `no-internal-exports` plugin for Rolldown.
 *
 * @example
 * import noInternalExports from "@esplugins/no-internal-exports/rolldown";
 *
 * noInternalExports({ tags: ["internal", "dontexport"] });
 */
export const noInternalExportsRolldown = noInternalExportsUnplugin.rolldown;

export default noInternalExportsRolldown;

export type { NoInternalExportsOptions } from "@/core";
