/* eslint-disable no-await-in-loop -- statements are processed in source order, which decides star export precedence */
import type { SourceMap } from "magic-string";
import MagicString from "magic-string";
import type { ExportAllDeclaration, ExportDefaultDeclaration, ExportNamedDeclaration } from "oxc-parser";
import type { ExportGraph } from "./exportGraph";
import type { ParsedModule } from "./parseModule";
import { declarationInfo, moduleExportName } from "./parseModule";
import type { ModuleExportNames, ModuleRecord } from "./types";

//----------------------
// Types
//----------------------

/** @internal */
export interface RewriteResult {
	/** `false` if the entry file exports nothing internal (`code` is then the unchanged source). */
	changed: boolean;
	code: string;
	/** Sourcemap from the original to the rewritten entry file (only when `changed`). */
	map: SourceMap | undefined;
	/** Export names removed from the entry file. */
	removed: string[];
	warnings: string[];
}

interface Edit {
	end: number;
	start: number;
	text: string;
}

interface AnalyzedStar {
	names: ModuleExportNames;
	statement: ExportAllDeclaration;
}

interface RewriteContext {
	appended: string[];
	edits: Edit[];
	/** Names re-emitted from expanded `export *`, so a name shared by two stars is only emitted once. */
	emitted: Set<string>;
	/** Final export names of the entry (lazy: only needed when some `export *` has to be expanded). */
	entryNames: () => Promise<ModuleExportNames>;
	graph: ExportGraph;
	record: ModuleRecord;
	removed: Set<string>;
	source: string;
	warnings: string[];
}

//----------------------
// Helpers
//----------------------

/**
 * Names that can be written unquoted in export lists; anything else is emitted as a string literal.
 * Not a regex literal: the `optimize-regex` lint rule crashes on `\p{...}` inside character classes.
 */
// eslint-disable-next-line prefer-regex-literals, @EslintSecurity/detect-non-literal-regexp
const IDENTIFIER = new RegExp(String.raw`^[$_\p{ID_Start}][$\p{ID_Continue}]*$`, "u");

const formatName = (name: string): string => (IDENTIFIER.test(name) ? name : JSON.stringify(name));

const isInternal = async (context: RewriteContext, name: string): Promise<boolean> => {
	const resolution = await context.graph.resolveExport(context.record, name);
	return resolution?.internal ?? false;
};

/** `"./x" with { type: "json" }` without the trailing semicolon. */
const fromClause = (source: string, statement: ExportAllDeclaration | ExportNamedDeclaration): string =>
	source.slice(statement.source!.start, statement.end).replace(/\s*;$/u, "");

const isBareSpecifier = (specifier: string): boolean => !/^(?:\.{1,2}(?:[/\\]|$)|[/\\]|[A-Za-z]:)/u.test(specifier);

//----------------------
// Statement handlers
//----------------------

const rewriteNamedExport = async (context: RewriteContext, statement: ExportNamedDeclaration) => {
	const { appended, edits, removed, source } = context;
	const { declaration, specifiers, start: statementStart } = statement;

	if (declaration) {
		const internal: string[] = [];
		const kept: string[] = [];
		for (const name of declarationInfo(declaration).names) {
			((await isInternal(context, name)) ? internal : kept).push(name);
		}
		if (internal.length === 0) return;

		// `export const a = 1` -> `const a = 1`: the binding stays usable inside the entry file.
		edits.push({ end: declaration.start, start: statementStart, text: "" });
		if (kept.length > 0) appended.push(`export { ${kept.map(name => formatName(name)).join(", ")} };`);
		for (const name of internal) removed.add(name);
		return;
	}

	if (specifiers.length === 0) return;

	const kept: string[] = [];
	for (const specifier of specifiers) {
		const exported = moduleExportName(specifier.exported);
		if (await isInternal(context, exported)) removed.add(exported);
		else kept.push(source.slice(specifier.start, specifier.end));
	}
	if (kept.length === specifiers.length) return;

	// Only the specifier list changes; `export type`, `from "..."` and import attributes are kept as written.
	// An emptied `export {} from "./x"` still evaluates `./x`, preserving its side effects.
	const start = specifiers[0].start;
	const end = source.indexOf("}", specifiers.at(-1)!.end);
	edits.push({ end, start, text: kept.length > 0 ? `${kept.join(", ")} ` : "" });
};

const rewriteNamespaceExport = async (context: RewriteContext, statement: ExportAllDeclaration) => {
	const name = moduleExportName(statement.exported!);
	if (!(await isInternal(context, name))) return;
	context.removed.add(name);
	context.edits.push({
		end: statement.end,
		start: statement.start,
		text: statement.exportKind === "type" ? "" : `import ${fromClause(context.source, statement)};`
	});
};

/** Names of an `export *` target that must not be exported by the entry file. */
const hiddenStarNames = async (context: RewriteContext, star: AnalyzedStar): Promise<string[]> => {
	const hidden: string[] = [];
	for (const [name, resolution] of star.names.names) {
		if (name === "default") continue;
		// An explicit export shadows the star one: hidden only if that explicit export is internal itself.
		const isHidden = context.record.exports.has(name) ? await isInternal(context, name) : resolution.internal;
		if (isHidden) hidden.push(name);
	}
	return hidden;
};

/** Replaces `export * from "x"` with explicit export lists without internal names. */
const expandStarExport = async (context: RewriteContext, star: AnalyzedStar) => {
	const { names, statement } = star;
	const from = fromClause(context.source, statement);
	const entryNames = await context.entryNames();

	const values: string[] = [];
	const types: string[] = [];
	for (const [name, resolution] of names.names) {
		const skip =
			name === "default" ||
			resolution.internal ||
			context.record.exports.has(name) || // shadowed by an explicit export
			context.emitted.has(name) || // already provided by a previous star
			!entryNames.names.has(name); // ambiguous between stars: not exported in ES semantics
		if (skip) continue;
		context.emitted.add(name);
		(resolution.isType || statement.exportKind === "type" ? types : values).push(formatName(name));
	}
	for (const name of await hiddenStarNames(context, star)) context.removed.add(name);

	const parts: string[] = [];
	if (values.length > 0) parts.push(`export { ${values.join(", ")} } from ${from};`);
	if (types.length > 0) parts.push(`export type { ${types.join(", ")} } from ${from};`);
	if (parts.length === 0) parts.push(`import ${from};`);

	// Stars the graph could not look into are forwarded as-is when they resolve the same from the entry file.
	for (const opaque of names.opaque) {
		if (isBareSpecifier(opaque.specifier)) {
			parts.push(`export ${opaque.isType ? "type " : ""}* from ${JSON.stringify(opaque.specifier)};`);
		} else {
			context.warnings.push(
				`Could not analyze \`export * from "${opaque.specifier}"\` in "${opaque.importer}", so its exports are not re-exported from the entry file.`
			);
		}
	}

	context.edits.push({ end: statement.end, start: statement.start, text: parts.join(" ") });
};

/**
 * Expands the entry's `export *` statements if any of them would expose an internal name.
 * All analyzable stars are expanded together: expanding only some would turn names that are
 * ambiguous between stars (and therefore not exported) into exported ones.
 */
const rewriteStarExports = async (context: RewriteContext, statements: ExportAllDeclaration[]) => {
	const stars: AnalyzedStar[] = [];
	for (const statement of statements) {
		const target = await context.graph.load(statement.source.value, context.record.path);
		// External / virtual modules can't be analyzed, so nothing tagged can be detected there: keep as-is.
		if (target) stars.push({ names: await context.graph.exportNames(target), statement });
	}

	let needsExpansion = false;
	for (const star of stars) {
		const hidden = await hiddenStarNames(context, star);
		if (hidden.length > 0) needsExpansion = true;
	}
	if (!needsExpansion) return;

	for (const star of stars) await expandStarExport(context, star);
};

const rewriteDefaultExport = async (context: RewriteContext, statement: ExportDefaultDeclaration) => {
	if (!(await isInternal(context, "default"))) return;
	context.removed.add("default");

	const { declaration, start } = statement;
	const hasName =
		(declaration.type === "FunctionDeclaration" ||
			declaration.type === "ClassDeclaration" ||
			declaration.type === "TSInterfaceDeclaration") &&
		declaration.id !== null;

	if (hasName) {
		context.edits.push({ end: declaration.start, start, text: "" });
		return;
	}

	// Anonymous declaration / expression: keep evaluating it, without exporting.
	context.edits.push(
		{ end: declaration.start, start, text: "void (" },
		{ end: declaration.end, start: declaration.end, text: ")" }
	);
};

//----------------------
// Main
//----------------------

/**
 * Removes internal exports from the entry file's source with minimal, position-preserving edits.
 * @internal
 */
export const rewriteEntry = async (
	graph: ExportGraph,
	record: ModuleRecord,
	parsed: ParsedModule
): Promise<RewriteResult> => {
	let entryNames: Promise<ModuleExportNames> | undefined;
	const context: RewriteContext = {
		appended: [],
		edits: [],
		emitted: new Set(),
		entryNames: async () => (entryNames ??= graph.exportNames(record)),
		graph,
		record,
		removed: new Set(),
		source: parsed.source,
		warnings: []
	};

	const starStatements: ExportAllDeclaration[] = [];
	for (const statement of parsed.program.body) {
		if (statement.type === "ExportNamedDeclaration") await rewriteNamedExport(context, statement);
		else if (statement.type === "ExportDefaultDeclaration") await rewriteDefaultExport(context, statement);
		else if (statement.type === "ExportAllDeclaration") {
			if (statement.exported) await rewriteNamespaceExport(context, statement);
			else starStatements.push(statement);
		}
	}
	await rewriteStarExports(context, starStatements);

	const output = new MagicString(parsed.source);
	for (const { end, start, text } of context.edits) {
		if (start === end) output.appendLeft(start, text);
		else if (text === "") output.remove(start, end);
		else output.overwrite(start, end, text);
	}
	if (context.appended.length > 0) output.append(`\n${context.appended.join("\n")}\n`);

	const changed = output.hasChanged();
	return {
		changed,
		code: output.toString(),
		map: changed ? output.generateMap({ hires: true, includeContent: true, source: record.path }) : void 0,
		// eslint-disable-next-line @EslintUnicorn/prefer-spread -- conflicts with @EslintPrefArrayFunc/prefer-array-from
		removed: Array.from(context.removed),
		warnings: context.warnings
	};
};

export default rewriteEntry;
