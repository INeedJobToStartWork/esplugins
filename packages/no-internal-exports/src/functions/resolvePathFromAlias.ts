import { tryFile } from "@/functions";
import { resolve } from "node:path";
import type { CompilerOptions } from "typescript";

/**
 * Solve Path Alias from Typescript config.
 *
 * @internal
 */
export function resolvePathFromAlias(importPath: string, compilerOptions: CompilerOptions): string | undefined {
	if (!compilerOptions.paths) return void 0;

	for (const [alias, paths] of Object.entries(compilerOptions.paths)) {
		const aliasPattern = alias.replaceAll("*", "(.*)");
		// eslint-disable-next-line @EslintSecurity/detect-non-literal-regexp
		const match = new RegExp(`^${aliasPattern}$`, "u").exec(importPath);

		if (match) {
			const [, rest] = match;
			const resolvedPath = paths[0].replace("*", rest);
			const fullPath = resolve(process.cwd(), compilerOptions.baseUrl || ".", resolvedPath);
			const file = tryFile(fullPath);
			if (file) return file;
		}
	}

	return void 0;
}

export default resolvePathFromAlias;
