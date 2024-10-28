/* eslint-disable @EslintOptRegConf/optimize-regex */
/* eslint-disable @EslintSecurity/detect-unsafe-regex */
/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @EslintUnicorn/no-null */
/* eslint-disable complexity */

import type { Plugin } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { CompilerOptions } from "typescript";
import type { IMyError, TMyErrorList } from "oh-my-error";
import { myError } from "oh-my-error";
import { tryFile, resolvePathFromAlias, findAllExports } from "@/functions";
import { findEntryPoint, findTsConfigPath, parseCompilerOptions } from "@/utils";

//----------------------
// Errors
//----------------------

const MyErrorList = {
	NO_ENTRY_POINT: {
		code: "NO_ENTRY_POINT",
		name: "No Entry Point",
		message: "No Entry Point been founded",
		hint: "Setup EntryPoint at your esbuild/tsup config!"
	} satisfies IMyError,
	COULDNT_FIND_EXPORTS: {
		code: "COULDNT_FIND_EXPORTS",
		name: "Couldnt Find Exports",
		message: "Coudlnt find Exports"
	} satisfies IMyError
} as const satisfies TMyErrorList;

//----------------------
// Plugin
//----------------------

export const noInternalExports: Plugin = {
	name: "no-internal-exports",
	setup(build) {
		let internalFunctions = new Set<string>();
		let entryPoint: string;
		let entryPath: string;
		let tsConfigPath: string | undefined;
		let compilerOptions: CompilerOptions | undefined;

		build.onStart(async () => {
			if (!build.initialOptions.entryPoints?.length) {
				console.error(MyErrorList.NO_ENTRY_POINT);
				throw myError(MyErrorList.NO_ENTRY_POINT);
			}

			entryPoint = findEntryPoint(build);
			entryPath = resolve(process.cwd(), entryPoint);
			tsConfigPath = findTsConfigPath(build);
			compilerOptions = parseCompilerOptions(tsConfigPath);

			const visitedFiles = new Set<string>();

			const scanForInternals = async (filePath: string) => {
				const resolvedPath = tryFile(filePath);
				if (!resolvedPath || visitedFiles.has(resolvedPath)) return;

				visitedFiles.add(resolvedPath);
				const source = readFileSync(resolvedPath, "utf8");
				const PATTERN_INTERNAL =
					/\/\*\*[\S\s]*?(?:@internal|@dontexport)[\S\s]*?\*\/\s*(?:export\s+)?(?:function|const|let|var|class|type|interface)?\s*(\w+)/gimu;

				let match;
				while ((match = PATTERN_INTERNAL.exec(source)) !== null) {
					const functionName = match[1];
					internalFunctions.add(functionName);
					console.log(`Found internal Function "${functionName}" in ${relative(process.cwd(), resolvedPath)}`);
				}

				const importRegex = /(?:import|export)\s+.*?from\s+["']([^"']+)["']/gu;
				while ((match = importRegex.exec(source)) !== null) {
					const importPath = match[1];
					let resolvedImportPath = importPath;

					if (compilerOptions && importPath.startsWith("@")) {
						const resolved = resolvePathFromAlias(importPath, compilerOptions);
						if (resolved && !visitedFiles.has(resolved)) {
							resolvedImportPath = resolved;
							await scanForInternals(resolvedImportPath);
						}
					} else {
						try {
							resolvedImportPath = resolve(dirname(resolvedPath), importPath);
							await scanForInternals(resolvedImportPath);
						} catch {
							console.error(`Could not resolve import path: ${importPath}`);
						}
					}
				}
			};

			await scanForInternals(entryPath);
		});

		build.onLoad({ filter: /\.(js|ts|jsx|mts|mjs|cts|cjs|tsx)$/ }, async args => {
			try {
				if (args.path !== entryPath) return void 0;

				const source = readFileSync(args.path, "utf8");
				const exportedNames = new Set();
				let updatedSource = "";

				const declarations = [];
				const exportRegex =
					/export\s+(const|let|var|function|class|interface|type|enum)\s+([$A-Z_a-z][\w$]*)[^;{]*(?:\{[^}]*\}|=[^;]*|[^;{]*)(?:;|\n|$)/gu;
				let match;

				const sourceWithoutStarExports = source.replaceAll(/export\s*\*\s*from\s*["'][^"']+["'];?\s*/gu, "");

				while ((match = exportRegex.exec(sourceWithoutStarExports)) !== null) {
					const exportName = match[2];
					const fullMatch = match[0];
					const isInternal = internalFunctions.has(exportName);

					if (!isInternal) exportedNames.add(exportName);

					declarations.push({
						name: exportName,
						content: fullMatch.replace("export ", "")
					});
				}
				console.log(`TEST: ${declarations}`);

				const starExportRegex = /export\s*\*\s*from\s*["'](.*)["']/gu;
				const moduleExports = new Map();

				while ((match = starExportRegex.exec(source)) !== null) {
					const sourcePath = match[1];
					let resolvedPath = sourcePath;

					if (compilerOptions && sourcePath.startsWith("@")) {
						const resolved = resolvePathFromAlias(sourcePath, compilerOptions);
						if (resolved) {
							resolvedPath = resolved;
						}
					} else {
						resolvedPath = resolve(dirname(args.path), sourcePath);
					}

					try {
						const exports = findAllExports(resolvedPath, compilerOptions);
						const safeExports = [
							...exports.fileExports,
							...exports.starExports.flatMap(star => star.fileExports)
						].filter(exp => !internalFunctions.has(exp));

						for (const exp of safeExports) {
							moduleExports.set(exp, sourcePath);
						}
					} catch (error) {
						console.error(`Error processing exports from ${resolvedPath}:`, error);
					}
				}

				updatedSource = declarations.map(d => d.content).join("\n\n");

				const externalExportsBySource = new Map();
				for (const [exportName, sourcePath] of moduleExports.entries()) {
					if (!internalFunctions.has(exportName) && !exportedNames.has(exportName)) {
						if (!externalExportsBySource.has(sourcePath)) {
							externalExportsBySource.set(sourcePath, []);
						}
						externalExportsBySource.get(sourcePath).push(exportName);
					}
				}

				const localExports = [...exportedNames].filter(name => !internalFunctions.has(name));
				if (localExports.length > 0) {
					updatedSource += `\n\nexport {\n  ${localExports.join(",\n  ")}\n};`;
				}

				for (const [sourcePath, exports] of externalExportsBySource.entries()) {
					if (exports.length > 0) {
						updatedSource += `\n\nexport {\n  ${exports.join(",\n  ")}\n} from '${sourcePath}';`;
					}
				}

				console.log("Generated source:", updatedSource);
				console.log("Local exports:", localExports);
				console.log("External exports by source:", Object.fromEntries(externalExportsBySource));

				return {
					contents: updatedSource,
					loader: "ts"
				};
			} catch (error) {
				console.error("Error in onLoad:", error);
			}

			return void 0;
		});
	}
};

export default noInternalExports;
