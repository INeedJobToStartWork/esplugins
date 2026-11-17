//----------------------
// Types
//----------------------

/**
 * Checks whether the text of a block comment contains one of the configured tags.
 * @internal
 */
export type TagMatcher = (commentValue: string) => boolean;

/**
 * Binding declared in the module itself (`const`, `function`, `class`, `interface`, ...).
 * @internal
 */
export interface LocalBinding {
	/** Every declaration of the binding is type-only (erased from JS output). */
	isType: boolean;
	/** At least one declaration of the binding has a tag in its leading comment. */
	tagged: boolean;
}

/**
 * `export const x`, `export { x }`, `export { x as y }`, `export default ...`.
 * @internal
 */
export interface LocalExport {
	isType: boolean;
	kind: "local";
	/** Name of the local binding, `undefined` for anonymous `export default <expression>`. */
	local: string | undefined;
	/** Tag placed directly on the export statement or specifier. */
	tagged: boolean;
}

/**
 * `export { x } from "./y"` or `export * as ns from "./y"` (`imported` is `"*"`).
 * @internal
 */
export interface ReExport {
	imported: string;
	isType: boolean;
	kind: "reexport";
	specifier: string;
	tagged: boolean;
}

/** @internal */
export type ExportEntry = LocalExport | ReExport;

/**
 * `import { imported as local } from "specifier"` (`imported` is `"*"` for namespace imports).
 * @internal
 */
export interface ImportBinding {
	imported: string;
	isType: boolean;
	specifier: string;
}

/**
 * `export * from "specifier"` / `export type * from "specifier"`.
 * @internal
 */
export interface StarExport {
	isType: boolean;
	specifier: string;
}

/**
 * Static module shape: everything needed to answer "is export X internal?".
 * @internal
 */
export interface ModuleRecord {
	exports: Map<string, ExportEntry>;
	imports: Map<string, ImportBinding>;
	locals: Map<string, LocalBinding>;
	path: string;
	stars: StarExport[];
}

/**
 * Where an export finally comes from and whether it is internal.
 * @internal
 */
export interface ExportResolution {
	/** Tagged anywhere on the way from the entry file to the original declaration. */
	internal: boolean;
	isType: boolean;
	/** Identity of the original binding (`path#name`), used to detect ambiguous star exports. */
	origin: string;
}

/**
 * `export * from` target that could not be analyzed (external, virtual or unresolvable module).
 * @internal
 */
export interface OpaqueStar {
	importer: string;
	isType: boolean;
	specifier: string;
}

/**
 * Every name a module exposes, with star exports flattened.
 * @internal
 */
export interface ModuleExportNames {
	names: Map<string, ExportResolution>;
	opaque: OpaqueStar[];
}

/**
 * Resolves `specifier` relative to `importer` and returns its record, or `undefined` if it can't be analyzed.
 * @internal
 */
export type ModuleLoader = (specifier: string, importer: string) => Promise<ModuleRecord | undefined>;
