/* eslint-disable @typescript-eslint/unbound-method */
import { findConfigFile, sys } from "typescript";

export const findTsConfigPath = (build: { initialOptions: { tsconfig?: string } }): string | undefined =>
	build.initialOptions.tsconfig ?? findConfigFile(process.cwd(), sys.fileExists, "tsconfig.json") ?? void 0;

export default findTsConfigPath;
