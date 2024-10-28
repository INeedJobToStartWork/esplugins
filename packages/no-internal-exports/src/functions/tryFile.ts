/* eslint-disable complexity */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Checks under path it's existing file or barrel file (index.ts at folder)
 *
 * @internal
 */
export function tryFile(basePath: string): string | undefined {
	const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"] as const;

	let isExistingFile = (path: string) => existsSync(path) && statSync(path).isFile();
	if (isExistingFile(basePath)) return basePath;

	for (const ext of extensions) {
		const pathWithExt = basePath + ext;
		if (isExistingFile(pathWithExt)) return pathWithExt;
	}

	if (existsSync(basePath) && statSync(basePath).isDirectory()) {
		for (const ext of extensions) {
			const indexPath = join(basePath, `index${ext}`);
			if (isExistingFile(indexPath)) return indexPath;
		}
	}

	return void 0;
}
export default tryFile;
