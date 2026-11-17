import { extname } from "node:path";
import type {
	BindingPattern,
	Comment,
	Declaration,
	ExportAllDeclaration,
	ExportDefaultDeclaration,
	ExportNamedDeclaration,
	ImportDeclaration,
	ImportDeclarationSpecifier,
	ModuleExportName,
	ParserOptions,
	Program
} from "oxc-parser";
import { parseSync } from "oxc-parser";
import type { ExportEntry, LocalBinding, ModuleRecord, TagMatcher } from "./types";

//----------------------
// Types
//----------------------

/** @internal */
export interface ParsedModule {
	/** Block comments only, sorted by position. */
	comments: Comment[];
	program: Program;
	source: string;
}

/** @internal */
export interface DeclarationInfo {
	isType: boolean;
	names: string[];
}

interface RecordContext {
	record: ModuleRecord;
	/** `true` if a tagged block comment lies fully inside `[from, to)`. */
	tagBetween: (from: number, to: number) => boolean;
}

//----------------------
// Constants
//----------------------

const LANG_BY_EXTENSION: Partial<Record<string, ParserOptions["lang"]>> = {
	".ts": "ts",
	".mts": "ts",
	".cts": "ts",
	".tsx": "tsx"
};

const DECLARATION_TYPES = new Set<string>([
	"VariableDeclaration",
	"FunctionDeclaration",
	"TSDeclareFunction",
	"ClassDeclaration",
	"TSTypeAliasDeclaration",
	"TSInterfaceDeclaration",
	"TSEnumDeclaration",
	"TSModuleDeclaration",
	"TSImportEqualsDeclaration"
]);

//----------------------
// Parsing
//----------------------

/**
 * Parses JS/TS source. Returns `undefined` on syntax errors, so esbuild can report them itself.
 * @internal
 */
export const parseSource = (path: string, source: string): ParsedModule | undefined => {
	const lang = LANG_BY_EXTENSION[extname(path)] ?? "jsx";
	const result = parseSync(path, source, { lang, sourceType: "module" });
	if (result.errors.some(error => String(error.severity) === "Error")) return void 0;

	return {
		source,
		program: result.program,
		comments: result.comments.filter(comment => comment.type === "Block").sort((a, b) => a.start - b.start)
	};
};

//----------------------
// AST helpers
//----------------------

/** @internal */
export const moduleExportName = (node: ModuleExportName): string => (node.type === "Literal" ? node.value : node.name);

/** @internal */
export const bindingNames = (pattern: BindingPattern | null): string[] => {
	if (!pattern) return [];
	switch (pattern.type) {
		case "Identifier": {
			return [pattern.name];
		}
		case "AssignmentPattern": {
			return bindingNames(pattern.left);
		}
		case "ArrayPattern": {
			return pattern.elements.flatMap(element =>
				element?.type === "RestElement" ? bindingNames(element.argument) : bindingNames(element)
			);
		}
		case "ObjectPattern": {
			return pattern.properties.flatMap(property =>
				property.type === "RestElement" ? bindingNames(property.argument) : bindingNames(property.value)
			);
		}
		default: {
			return [];
		}
	}
};

/**
 * Names declared by a declaration and whether it only exists at type level.
 * @internal
 */
export const declarationInfo = (declaration: Declaration): DeclarationInfo => {
	switch (declaration.type) {
		case "VariableDeclaration": {
			return {
				names: declaration.declarations.flatMap(declarator => bindingNames(declarator.id)),
				isType: declaration.declare === true
			};
		}
		case "FunctionDeclaration":
		case "TSDeclareFunction":
		case "ClassDeclaration": {
			return {
				names: declaration.id ? [declaration.id.name] : [],
				isType: declaration.declare === true || declaration.type === "TSDeclareFunction"
			};
		}
		case "TSTypeAliasDeclaration":
		case "TSInterfaceDeclaration": {
			return { names: [declaration.id.name], isType: true };
		}
		case "TSEnumDeclaration": {
			return { names: [declaration.id.name], isType: declaration.declare };
		}
		case "TSModuleDeclaration": {
			return declaration.id.type === "Identifier"
				? { names: [declaration.id.name], isType: declaration.declare }
				: { names: [], isType: true };
		}
		case "TSImportEqualsDeclaration": {
			return { names: [declaration.id.name], isType: false };
		}
		default: {
			return { names: [], isType: false };
		}
	}
};

const importedName = (specifier: ImportDeclarationSpecifier): string => {
	if (specifier.type === "ImportSpecifier") return moduleExportName(specifier.imported);
	return specifier.type === "ImportDefaultSpecifier" ? "default" : "*";
};

//----------------------
// Comments
//----------------------

/**
 * Returns `true` if a tagged block comment lies fully inside `[from, to)`.
 * @internal
 */
export const hasTagBetween = (comments: Comment[], from: number, to: number, isTag: TagMatcher): boolean => {
	// Binary search for the first comment starting at or after `from`.
	let low = 0;
	let high = comments.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (comments[middle].start < from) low = middle + 1;
		else high = middle;
	}

	for (let index = low; index < comments.length && comments[index].end <= to; index++) {
		if (isTag(comments[index].value)) return true;
	}
	return false;
};

//----------------------
// Module record
//----------------------

const addLocal = (record: ModuleRecord, name: string, binding: LocalBinding) => {
	const previous = record.locals.get(name);
	record.locals.set(
		name,
		previous ? { isType: previous.isType && binding.isType, tagged: previous.tagged || binding.tagged } : binding
	);
};

const addExport = (record: ModuleRecord, name: string, entry: ExportEntry) => {
	const previous = record.exports.get(name);
	// Repeated names come from TS function overloads / declaration merging: merge their flags.
	record.exports.set(
		name,
		previous ? { ...entry, isType: previous.isType && entry.isType, tagged: previous.tagged || entry.tagged } : entry
	);
};

const collectImport = ({ record }: RecordContext, statement: ImportDeclaration) => {
	for (const specifier of statement.specifiers) {
		record.imports.set(specifier.local.name, {
			imported: importedName(specifier),
			isType:
				statement.importKind === "type" || (specifier.type === "ImportSpecifier" && specifier.importKind === "type"),
			specifier: statement.source.value
		});
	}
};

const collectNamedExport = (context: RecordContext, statement: ExportNamedDeclaration, tagged: boolean) => {
	const { record, tagBetween } = context;
	const { declaration, exportKind, source, specifiers, start } = statement;

	if (declaration) {
		const declarationTagged = tagged || tagBetween(start, declaration.start);
		const { isType, names } = declarationInfo(declaration);
		for (const name of names) {
			addLocal(record, name, { isType, tagged: declarationTagged });
			addExport(record, name, { isType, kind: "local", local: name, tagged: declarationTagged });
		}
		return;
	}

	let specifierFrom = start;
	for (const specifier of specifiers) {
		const specifierTagged = tagged || tagBetween(specifierFrom, specifier.start);
		specifierFrom = specifier.end;
		const isType = exportKind === "type" || specifier.exportKind === "type";
		const local = moduleExportName(specifier.local);

		addExport(
			record,
			moduleExportName(specifier.exported),
			source
				? { imported: local, isType, kind: "reexport", specifier: source.value, tagged: specifierTagged }
				: { isType, kind: "local", local, tagged: specifierTagged }
		);
	}
};

const collectStarExport = ({ record }: RecordContext, statement: ExportAllDeclaration, tagged: boolean) => {
	const isType = statement.exportKind === "type";
	if (statement.exported) {
		addExport(record, moduleExportName(statement.exported), {
			imported: "*",
			isType,
			kind: "reexport",
			specifier: statement.source.value,
			tagged
		});
	} else {
		record.stars.push({ isType, specifier: statement.source.value });
	}
};

const collectDefaultExport = (context: RecordContext, statement: ExportDefaultDeclaration, tagged: boolean) => {
	const { declaration, start } = statement;
	const declarationTagged = tagged || context.tagBetween(start, declaration.start);
	let local: string | undefined;
	let isType = false;

	if (
		(declaration.type === "FunctionDeclaration" ||
			declaration.type === "ClassDeclaration" ||
			declaration.type === "TSInterfaceDeclaration") &&
		declaration.id
	) {
		local = declaration.id.name;
		isType = declaration.type === "TSInterfaceDeclaration";
		addLocal(context.record, local, { isType, tagged: declarationTagged });
	} else if (declaration.type === "Identifier") {
		local = declaration.name;
	}

	addExport(context.record, "default", { isType, kind: "local", local, tagged: declarationTagged });
};

/**
 * Collects exports, imports, star re-exports and tagged declarations of a parsed module.
 * A declaration is tagged when a block comment with a tag sits between the previous statement and it.
 * @internal
 */
export const createModuleRecord = (path: string, parsed: ParsedModule, isTag: TagMatcher): ModuleRecord => {
	const record: ModuleRecord = { exports: new Map(), imports: new Map(), locals: new Map(), path, stars: [] };
	const context: RecordContext = {
		record,
		tagBetween: (from, to) => hasTagBetween(parsed.comments, from, to, isTag)
	};

	let previousEnd = 0;
	for (const statement of parsed.program.body) {
		const tagged = context.tagBetween(previousEnd, statement.start);
		previousEnd = statement.end;

		switch (statement.type) {
			case "ImportDeclaration": {
				collectImport(context, statement);
				break;
			}
			case "ExportNamedDeclaration": {
				collectNamedExport(context, statement, tagged);
				break;
			}
			case "ExportAllDeclaration": {
				collectStarExport(context, statement, tagged);
				break;
			}
			case "ExportDefaultDeclaration": {
				collectDefaultExport(context, statement, tagged);
				break;
			}
			default: {
				if (!DECLARATION_TYPES.has(statement.type)) break;
				const { isType, names } = declarationInfo(statement as Declaration);
				for (const name of names) addLocal(record, name, { isType, tagged });
			}
		}
	}

	return record;
};
