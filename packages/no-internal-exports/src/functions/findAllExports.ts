/* eslint-disable complexity */
import { resolve } from "node:dns";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolvePathFromAlias, tryFile } from "@/functions";

import type { CompilerOptions } from "typescript";

export const findAllExports = (path: string, compilerOptions: CompilerOptions | undefined) => {
	const result = {
		filename: path.split("/").pop()?.split(".")[0] || "",
		fileExports: [] as string[],
		starExports: [] as Array<{ fileExports: string[]; from: string }>
	};

	try {
		const resolvedFilePath = tryFile(path);
		if (!resolvedFilePath) throw new Error(`Could not find file: ${path}`);

		const content = readFileSync(resolvedFilePath, "utf8");
		const PATTERN_EXPORT = /export\s+(const|let|var|function|class|interface|type|enum)\s+([$A-Z_a-z][\w$]*)/gu;
		// eslint-disable-next-line @EslintOptRegConf/optimize-regex
		const PATTERN_EXPORT_NAMED = /export\s*\{\s*([^}]+)\}/gu;
		const PATTERN_EXPORT_STAR = /export\s*\*\s*from\s*["'](.*)["']/gu;

		let match;
		while ((match = PATTERN_EXPORT.exec(content)) !== null) result.fileExports.push(match[2]);
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

			if (compilerOptions && sourcePath.startsWith("@")) {
				const resolved = resolvePathFromAlias(sourcePath, compilerOptions);
				if (resolved) {
					resolvedPath = resolved;
				}
			} else {
				resolvedPath = resolve(dirname(path), sourcePath);
			}

			try {
				const nestedExports = findAllExports(resolvedPath, compilerOptions);
				result.starExports.push({
					from: sourcePath,
					fileExports: [...nestedExports.fileExports, ...nestedExports.starExports.flatMap(exp => exp.fileExports)]
				});
			} catch (error) {
				console.error(`Error analyzing nested exports from ${resolvedPath}:`, error);
			}
		}
	} catch (error) {
		console.error(`Error analyzing exports in ${path}:`, error);
	}

	return result;
};

export default findAllExports;
