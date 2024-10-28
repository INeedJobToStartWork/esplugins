/* eslint-disable @typescript-eslint/unbound-method */
import { dirname } from "node:path";
import type { CompilerOptions } from "typescript";
import { parseJsonConfigFileContent, readConfigFile, sys } from "typescript";

export const parseCompilerOptions = (configPath: string | undefined): CompilerOptions | undefined => {
	if (!configPath) return void 0;

	const config: CompilerOptions = readConfigFile(configPath, sys.readFile).config as CompilerOptions;
	return parseJsonConfigFileContent(config, sys, dirname(configPath)).options;
};

export default parseCompilerOptions;
