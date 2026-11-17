import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { RspackOptions } from "@rspack/core";
import { rspack } from "@rspack/core";
import { rolldown } from "rolldown";
import type { RollupLog } from "rollup";
import { rollup } from "rollup";
import { build as tsdownBuild } from "tsdown";
import { build as viteBuild } from "vite";
import type { Configuration } from "webpack";
import webpack from "webpack";
import { afterAll, describe, expect, it } from "vitest";
import noInternalExportsRolldown from "@/entries/rolldown";
import noInternalExportsRollup from "@/entries/rollup";
import noInternalExportsRspack from "@/entries/rspack";
import noInternalExportsVite from "@/entries/vite";
import noInternalExportsWebpack from "@/entries/webpack";

//----------------------
// Helpers
//----------------------

const tempDirs: string[] = [];

afterAll(async () => {
	await Promise.all(tempDirs.map(async dir => rm(dir, { recursive: true, force: true })));
});

/**
 * Same project for every bundler; `ts` adds type-only exports. Public exports: `local`, `pub`, `visible`.
 * JS imports use full paths: plain Rollup has no Node-style resolution (extensions, directory index).
 */
const createProject = async (extension: "js" | "ts", entryImport?: string): Promise<string> => {
	const dir = await mkdtemp(join(tmpdir(), "no-internal-exports-unplugin-"));
	tempDirs.push(dir);
	const types = extension === "ts";
	const file = (path: string) => (types ? path : `${path}.js`);
	const files: Record<string, string> = {
		[`src/index.${extension}`]: `
			export * from "${entryImport ?? file("./lib/index")}";
			export { helper } from "${file("./lib/helpers")}";
			/** @internal */
			export const localSecret = 1;
			export const local = localSecret + 1;
		`,
		[`src/lib/index.${extension}`]: `
			export * from "${file("./helpers")}";
			/** @internal */
			export const deepSecret = 2;
			export const pub = deepSecret + 1;
			${types ? "export interface Options { a: number }" : ""}
		`,
		[`src/lib/helpers.${extension}`]: `
			/** @internal */
			export function helper() { return 1; }
			export function visible() { return helper(); }
		`
	};

	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	return dir;
};

const EXPECTED = ["local", "pub", "visible"];

/** webpack and Rspack `Stats` (method syntax: their `toString` option types differ). */
interface StatsLike {
	hasErrors(): boolean;
	toString(preset: "errors-only"): string;
}

const runWebpackLike = async (run: (callback: (error: Error | null, stats?: StatsLike) => void) => void) =>
	new Promise<void>((resolve, reject) => {
		run((error, stats) => {
			if (error) reject(error);
			else if (stats?.hasErrors()) reject(new Error(stats.toString("errors-only")));
			else resolve();
		});
	});

const importExports = async (file: string) => Object.keys((await import(pathToFileURL(file).href)) as object).sort();

//----------------------
// Tests
//----------------------

// Real builds (webpack especially) take longer than the default 5s.
describe("noInternalExports (unplugin)", { timeout: 60_000 }, () => {
	describe("[PASS]", () => {
		it("rollup", async () => {
			const dir = await createProject("js");
			const warnings: RollupLog[] = [];
			const bundle = await rollup({
				input: join(dir, "src/index.js"),
				plugins: [noInternalExportsRollup()],
				onwarn: warning => warnings.push(warning)
			});
			const { output } = await bundle.generate({ format: "es", sourcemap: true });

			expect([...output[0].exports].sort()).toEqual(EXPECTED);
			expect(bundle.watchFiles).toContain(join(dir, "src/lib/helpers.js"));
			expect(warnings.filter(warning => warning.code === "SOURCEMAP_BROKEN")).toEqual([]);
			await bundle.close();
		});

		it("rolldown", async () => {
			const dir = await createProject("ts");
			const bundle = await rolldown({
				input: join(dir, "src/index.ts"),
				plugins: [noInternalExportsRolldown()],
				logLevel: "silent"
			});
			const { output } = await bundle.generate({ format: "esm" });

			expect([...output[0].exports].sort()).toEqual(EXPECTED);
			await bundle.close();
		});

		it("tsdown (through the rolldown plugin)", async () => {
			const dir = await createProject("ts");
			await tsdownBuild({
				config: false,
				cwd: dir,
				entry: [join(dir, "src/index.ts")],
				outDir: join(dir, "dist"),
				format: ["esm"],
				dts: false,
				logLevel: "silent",
				plugins: [noInternalExportsRolldown()]
			});

			expect(await importExports(join(dir, "dist/index.mjs"))).toEqual(EXPECTED);
		});

		it("vite (library mode, with an alias)", async () => {
			const dir = await createProject("ts", "@/lib");
			const result = await viteBuild({
				root: dir,
				configFile: false,
				logLevel: "silent",
				plugins: [noInternalExportsVite()],
				resolve: { alias: { "@": join(dir, "src") } },
				build: {
					write: false,
					minify: false,
					lib: { entry: join(dir, "src/index.ts"), formats: ["es"], fileName: "index" }
				}
			});
			const outputs = (Array.isArray(result) ? result : [result]) as Array<{
				output: Array<{ exports?: string[]; isEntry?: boolean; type: string }>;
			}>;
			const entry = outputs[0].output.find(chunk => chunk.type === "chunk" && chunk.isEntry);

			expect([...(entry?.exports ?? [])].sort()).toEqual(EXPECTED);
		});

		it("webpack", async () => {
			const dir = await createProject("js");
			const config: Configuration = {
				context: dir,
				mode: "production",
				entry: "./src/index.js",
				target: "node",
				experiments: { outputModule: true },
				output: { path: join(dir, "dist"), filename: "index.mjs", library: { type: "module" } },
				optimization: { minimize: false },
				plugins: [noInternalExportsWebpack()]
			};
			const compiler = webpack(config)!;
			await runWebpackLike(callback => {
				compiler.run(callback);
			});
			await new Promise(resolve => {
				compiler.close(resolve);
			});

			expect(await importExports(join(dir, "dist/index.mjs"))).toEqual(EXPECTED);
		});

		it("rspack (TypeScript through builtin:swc-loader)", async () => {
			const dir = await createProject("ts");
			const config: RspackOptions = {
				context: dir,
				mode: "production",
				entry: "./src/index.ts",
				target: "node",
				output: { path: join(dir, "dist"), filename: "index.mjs", module: true, library: { type: "module" } },
				optimization: { minimize: false },
				resolve: { extensions: [".ts", ".js"] },
				module: {
					rules: [
						{
							test: /\.ts$/u,
							loader: "builtin:swc-loader",
							options: { jsc: { parser: { syntax: "typescript" } } },
							type: "javascript/auto"
						}
					]
				},
				plugins: [noInternalExportsRspack()]
			};
			const compiler = rspack(config);
			await runWebpackLike(callback => {
				compiler.run(callback);
			});
			await new Promise(resolve => {
				compiler.close(resolve);
			});

			expect(await importExports(join(dir, "dist/index.mjs"))).toEqual(EXPECTED);
		});
	});
});
