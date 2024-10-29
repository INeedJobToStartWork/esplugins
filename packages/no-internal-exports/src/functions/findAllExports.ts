import { readFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { resolvePathFromAlias, tryFile } from "@/functions";
import type { CompilerOptions } from "typescript";

interface ExportResult {
	fileExports: string[];
	filename: string;
	starExports: Array<{ fileExports: string[]; from: string }>;
}

export const findAllExports = (
	path: string,
	compilerOptions: CompilerOptions | undefined,
	visitedPaths: Set<string> = new Set()
): ExportResult => {
	const result: ExportResult = {
		filename: path.split("/").pop()?.split(".")[0] || "",
		fileExports: [],
		starExports: []
	};

	if (visitedPaths.has(path)) return result;

	visitedPaths.add(path);

	try {
		const resolvedFilePath = tryFile(path);
		if (!resolvedFilePath) {
			throw new Error(`Could not find file: ${path}`);
		}

		const content = readFileSync(resolvedFilePath, "utf8");

		const PATTERN_EXPORT = /export\s+(const|let|var|function|class|interface|type|enum)\s+([$A-Z_a-z][\w$]*)/gu;
		// eslint-disable-next-line @EslintOptRegConf/optimize-regex
		const PATTERN_EXPORT_NAMED = /export\s*\{\s*([^}]+)\}/gu;
		const PATTERN_EXPORT_STAR = /export\s*\*\s*from\s*["'](.*)["']/gu;

		let match;

		while ((match = PATTERN_EXPORT.exec(content)) !== null) {
			result.fileExports.push(match[2]);
		}

		while ((match = PATTERN_EXPORT_NAMED.exec(content)) !== null) {
			const exports = match[1].split(",").map(exp => {
				const trimmed = exp.trim();
				const asMatch = /(\w+)\s+as\s+(\w+)/u.exec(trimmed);
				return asMatch ? asMatch[2] : trimmed;
			});
			result.fileExports.push(...exports);
		}

		while ((match = PATTERN_EXPORT_STAR.exec(content)) !== null) {
			const sourcePath = match[1];
			let resolvedPath = sourcePath;

			try {
				if (compilerOptions && sourcePath.startsWith("@")) {
					const resolved = resolvePathFromAlias(sourcePath, compilerOptions);
					if (resolved) {
						resolvedPath = resolved;
					}
				} else {
					resolvedPath = pathResolve(dirname(resolvedFilePath), sourcePath);
				}

				if (!visitedPaths.has(resolvedPath)) {
					const nestedExports = findAllExports(resolvedPath, compilerOptions, visitedPaths);

					const allNestedExports = new Set([
						...nestedExports.fileExports,
						...nestedExports.starExports.flatMap(exp => exp.fileExports)
					]);

					result.starExports.push({
						from: sourcePath,
						fileExports: [...allNestedExports]
					});
				}
			} catch (error) {
				console.error(`Error analyzing nested exports from ${resolvedPath}:`, error);
			}
		}
	} catch (error) {
		console.error(`Error analyzing exports in ${path}:`, error);
	} finally {
		visitedPaths.delete(path);
	}

	return result;
};

export default findAllExports;
