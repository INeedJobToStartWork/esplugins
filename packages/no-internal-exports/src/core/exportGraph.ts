/* eslint-disable no-await-in-loop -- the graph is walked in source order: star order decides precedence and ambiguity */
import type { ExportEntry, ExportResolution, ModuleExportNames, ModuleLoader, ModuleRecord, OpaqueStar } from "./types";

//----------------------
// Types
//----------------------

interface FollowOptions {
	/** Name imported from the target module, `"*"` for namespaces. */
	imported: string;
	importer: ModuleRecord;
	isType: boolean;
	specifier: string;
	/** Tagged on the way to the target module. */
	tagged: boolean;
	visiting: Set<string>;
}

//----------------------
// Helpers
//----------------------

const asType = (resolution: ExportResolution, isType: boolean): ExportResolution =>
	isType && !resolution.isType ? { ...resolution, isType } : resolution;

//----------------------
// Class
//----------------------

/**
 * Follows exports across modules (re-exports, `import` + `export`, `export *`) to their original declaration.
 * Mirrors ES module semantics: explicit exports shadow star exports, and names that star exports provide
 * from different bindings are ambiguous and therefore not exported.
 * @internal
 */
export class ExportGraph {
	readonly load: ModuleLoader;

	constructor(load: ModuleLoader) {
		this.load = load;
	}

	/** Resolves export `name` of `record`, or `undefined` if the module does not export it. */
	async resolveExport(
		record: ModuleRecord,
		name: string,
		visiting = new Set<string>()
	): Promise<ExportResolution | undefined> {
		const key = `${record.path}\0${name}`;
		if (visiting.has(key)) return void 0; // circular re-export
		visiting.add(key);

		try {
			const entry = record.exports.get(name);
			if (entry) return await this.resolveEntry(record, name, entry, visiting);
			if (name === "default") return void 0; // `export *` never re-exports `default`

			let found: ExportResolution | undefined;
			for (const star of record.stars) {
				const target = await this.load(star.specifier, record.path);
				const resolution = target && (await this.resolveExport(target, name, visiting));
				if (!resolution) continue;
				if (found && found.origin !== resolution.origin) return void 0; // ambiguous
				found ??= asType(resolution, star.isType);
			}
			return found;
		} finally {
			visiting.delete(key);
		}
	}

	/** Lists every name `record` exports, flattening `export *` chains. */
	async exportNames(record: ModuleRecord, visiting = new Set<string>()): Promise<ModuleExportNames> {
		const names = new Map<string, ExportResolution>();
		const opaque: OpaqueStar[] = [];
		if (visiting.has(record.path)) return { names, opaque };
		visiting.add(record.path);

		try {
			for (const [name, entry] of record.exports) {
				names.set(name, await this.resolveEntry(record, name, entry, new Set()));
			}

			// `false` marks a name provided by several star exports with different origins.
			const fromStars = new Map<string, ExportResolution | false>();
			for (const star of record.stars) {
				const target = await this.load(star.specifier, record.path);
				if (!target) {
					opaque.push({ importer: record.path, isType: star.isType, specifier: star.specifier });
					continue;
				}

				const nested = await this.exportNames(target, visiting);
				opaque.push(...nested.opaque);
				for (const [name, resolution] of nested.names) {
					if (name === "default" || names.has(name)) continue;
					const previous = fromStars.get(name);
					if (previous === undefined) fromStars.set(name, asType(resolution, star.isType));
					else if (previous && previous.origin !== resolution.origin) fromStars.set(name, false);
				}
			}

			for (const [name, resolution] of fromStars) {
				if (resolution) names.set(name, resolution);
			}
			return { names, opaque };
		} finally {
			visiting.delete(record.path);
		}
	}

	private async resolveEntry(
		record: ModuleRecord,
		name: string,
		entry: ExportEntry,
		visiting: Set<string>
	): Promise<ExportResolution> {
		if (entry.kind === "reexport") {
			const { imported, isType, specifier, tagged } = entry;
			return this.follow({ imported, importer: record, isType, specifier, tagged, visiting });
		}

		const local = entry.local === undefined ? undefined : record.locals.get(entry.local);
		const tagged = entry.tagged || (local?.tagged ?? false);
		const binding = entry.local === undefined ? undefined : record.imports.get(entry.local);
		if (binding) {
			return this.follow({
				imported: binding.imported,
				importer: record,
				isType: entry.isType || binding.isType,
				specifier: binding.specifier,
				tagged,
				visiting
			});
		}

		return {
			internal: tagged,
			isType: entry.isType || (local?.isType ?? false),
			origin: `${record.path}#${entry.local ?? name}`
		};
	}

	private async follow({ imported, importer, isType, specifier, tagged, visiting }: FollowOptions) {
		const target = await this.load(specifier, importer.path);
		const origin = `${target?.path ?? specifier}#${imported}`;
		// Namespace re-exports are only internal when tagged themselves.
		if (imported === "*") return { internal: tagged, isType, origin };

		const resolution = target && (await this.resolveExport(target, imported, visiting));
		return {
			internal: tagged || (resolution?.internal ?? false),
			isType: isType || (resolution?.isType ?? false),
			origin: resolution?.origin ?? origin
		};
	}
}

export default ExportGraph;
