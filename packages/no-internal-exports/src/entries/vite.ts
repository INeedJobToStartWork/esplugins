import { noInternalExportsUnplugin } from "@/adapters/unplugin/factory";

//----------------------
// Plugin
//----------------------

/**
 * `no-internal-exports` plugin for Vite.
 *
 * @example
 * import noInternalExports from "@esplugins/no-internal-exports/vite";
 *
 * noInternalExports({ tags: ["internal", "dontexport"] });
 */
export const noInternalExportsVite = noInternalExportsUnplugin.vite;

export default noInternalExportsVite;

export type { NoInternalExportsOptions } from "@/core";
