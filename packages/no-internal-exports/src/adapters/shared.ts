import type { SourceMap } from "magic-string";
import type { EntryRewrite, EntryRewriter } from "@/core";
import { SCRIPT_FILTER } from "@/core";

//----------------------
// Types
//----------------------

/**
 * Result of a `transform` hook that changed the entry file.
 * @internal
 */
export interface TransformOutput {
	code: string;
	map: SourceMap | undefined;
}

//----------------------
// Helpers
//----------------------

/**
 * Module id without query (`?raw`, `?v=123`).
 * @internal
 */
export const cleanId = (id: string): string => id.split("?", 1)[0];

/**
 * Real script file (not a virtual `\0` module).
 * @internal
 */
export const isScriptModule = (id: string): boolean => !id.startsWith("\0") && SCRIPT_FILTER.test(cleanId(id));

/**
 * Reports warnings / debug output and converts a rewrite into a `transform` hook result.
 * @internal
 */
export const toTransformResult = (
	rewriter: EntryRewriter,
	path: string,
	result: EntryRewrite,
	warn: (message: string) => void
): TransformOutput | undefined => {
	for (const warning of result.warnings) warn(warning);
	rewriter.log(path, result.removed);
	return result.changed ? { code: result.code, map: result.map } : void 0;
};
