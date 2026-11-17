import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { BuildOptions, BuildResult } from "esbuild";
import * as esbuild from "esbuild";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { NoInternalExportsOptions } from "./plugin";
import noInternalExports, { createNoInternalExports } from "./plugin";

//----------------------
// Helpers
//----------------------

type Files = Record<string, string>;

const tempDirs: string[] = [];

afterAll(async () => {
	await Promise.all(tempDirs.map(async dir => rm(dir, { recursive: true, force: true })));
});

const createProject = async (files: Files): Promise<string> => {
	const dir = await mkdtemp(join(tmpdir(), "no-internal-exports-"));
	tempDirs.push(dir);
	await writeFiles(dir, files);
	return dir;
};

const writeFiles = async (dir: string, files: Files) => {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
};

interface BuildOutput {
	result: BuildResult<{ metafile: true; write: false }>;
	/** Export names of the first entry output. */
	exports: string[];
	code: string;
}

const run = async (
	dir: string,
	options: Omit<BuildOptions, "metafile" | "write"> = {},
	pluginOptions?: NoInternalExportsOptions
): Promise<BuildOutput> => {
	const result = await esbuild.build({
		absWorkingDir: dir,
		entryPoints: ["src/index.ts"],
		bundle: true,
		format: "esm",
		platform: "node",
		outdir: "out",
		logLevel: "silent",
		plugins: [pluginOptions ? createNoInternalExports(pluginOptions) : noInternalExports],
		...options,
		metafile: true,
		write: false
	});
	const entryOutput = Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint);
	const code = result.outputFiles.find(file => file.path.endsWith(".js"))?.text ?? "";
	return { result, exports: [...(entryOutput?.[1].exports ?? [])].sort(), code };
};

const build = async (files: Files, options?: BuildOptions, pluginOptions?: NoInternalExportsOptions) =>
	run(await createProject(files), options, pluginOptions);

const importCode = async (code: string): Promise<Record<string, unknown>> =>
	import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`) as Promise<Record<string, unknown>>;

//----------------------
// Tests
//----------------------

describe("noInternalExports", () => {
	describe("[PASS]", () => {
		it("removes internal exports reached through `export *` and tsconfig path aliases (README example)", async () => {
			const { exports, code } = await build({
				"tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "./src", paths: { "@/*": ["*"] } } }),
				"src/index.ts": `export * from "@/functions";`,
				"src/functions/index.ts": `export * from "./nameValidator";`,
				"src/functions/nameValidator.ts": `
					/** @internal */
					export const MAX_LENGTH = 256 as const;
					/** @internal */
					export const MAX_SAFE_NAME_LENGTH = MAX_LENGTH - 6;
					/**
					 * @internal
					 */
					export const MyErrorList = { TOO_LONG: { code: "TOO_LONG" } };

					/** Validates a name. */
					export const nameValidator = (name: string) => name.length <= MAX_SAFE_NAME_LENGTH;
					export default nameValidator;
				`
			});

			expect(exports).toEqual(["nameValidator"]);
			const module = await importCode(code);
			expect((module.nameValidator as (name: string) => boolean)("short")).toBe(true);
		});

		it("keeps internal declarations of the entry file usable, but not exported", async () => {
			const { exports, code } = await build({
				"src/index.ts": `
					/** @internal */
					export const base = 40;
					/** @internal */
					export function add(a: number, b: number) { return a + b; }
					/** @internal */
					export class Secret {}
					export const answer = add(base, 2);
				`
			});

			expect(exports).toEqual(["answer"]);
			expect((await importCode(code)).answer).toBe(42);
		});

		it("supports every JSDoc layout and the `@dontexport` tag", async () => {
			const { exports } = await build({
				"src/index.ts": `
					/** @internal */ export const a = 1;
					/**
					 * @internal */
					export const b = 2;
					/**
					 * Some description.
					 * @dontexport
					 */
					export enum Mode { A }
					/** @internal @dontexport */
					export interface Options { a: number }
					export const pub = 3;
				`
			});

			expect(exports).toEqual(["pub"]);
		});

		it("does not treat lookalikes as tags", async () => {
			const { exports } = await build({
				"src/index.ts": `
					/** Not internal, see @internalApi docs and email foo@internal.dev */
					export const a = 1;
					// @internal (line comments are not JSDoc)
					export const b = "@internal";
					/** @internal */
					const hidden = 3;
					export const c = hidden;
				`
			});

			expect(exports).toEqual(["a", "b", "c"]);
		});

		it("filters `export { ... }` lists using tags on declarations and on specifiers", async () => {
			const { exports } = await build({
				"src/index.ts": `
					const a = 1;
					/** @internal */
					const b = 2;
					const c = 3;
					export { a, b, b as bAlias, /** @internal */ c, c as cPublic };
				`
			});

			expect(exports).toEqual(["a", "cPublic"]);
		});

		it("follows re-export chains and imported bindings", async () => {
			const { exports } = await build({
				"src/index.ts": `
					import { helper, pub } from "./lib/a";
					export { helper, pub };
					export { helper as helper2, pub as pub2, deep } from "./lib/a";
				`,
				"src/lib/a.ts": `export { helper, pub, deep } from "./b";`,
				"src/lib/b.ts": `
					import { deep as original } from "./c";
					/** @internal */
					export function helper() {}
					export function pub() {}
					export { original as deep };
				`,
				"src/lib/c.ts": `/** @internal */ export const deep = 1;`
			});

			expect(exports).toEqual(["pub", "pub2"]);
		});

		it("respects tags placed on re-export statements", async () => {
			const { exports } = await build({
				"src/index.ts": `
					/** @internal */
					export { a } from "./lib";
					/** @internal */
					export * as ns from "./lib";
					export * as publicNs from "./lib";
					export { b } from "./lib";
				`,
				"src/lib.ts": `export const a = 1; export const b = 2;`
			});

			expect(exports).toEqual(["b", "publicNs"]);
		});

		it("removes internal default exports, named or anonymous", async () => {
			const named = await build({
				"src/index.ts": `/** @internal */ export default function main() {} export const a = main;`
			});
			const anonymous = await build({
				"src/index.ts": `/** @internal */\nexport default () => 1\nexport const a = 1;`
			});
			const viaList = await build({
				"src/index.ts": `/** @internal */ const main = 1; export { main as default, main as pub };`
			});

			expect(named.exports).toEqual(["a"]);
			expect(anonymous.exports).toEqual(["a"]);
			expect(viaList.exports).toEqual([]);
		});

		it("keeps ES semantics when expanding `export *` (shadowing, ambiguity, duplicates, types)", async () => {
			const { code, result } = await build({
				"src/index.ts": `
					export * from "./a";
					export * from "./b";
					export const shadowed = "entry";
				`,
				"src/a.ts": `
					export * from "./shared";
					/** @internal */ export const secretA = 1;
					export const ambiguous = "a";
					export const shadowed = "a";
					export interface TypeA { a: number }
					export { x as "kebab-name" } from "./shared";
				`,
				"src/b.ts": `
					export * from "./shared";
					export const ambiguous = "b";
					export const onlyB = 1;
				`,
				"src/shared.ts": `export const x = 1;`
			});

			// Asserted on the module itself: esbuild's metafile also lists ambiguous names it doesn't emit.
			const module = await importCode(code);
			expect(Object.keys(module).sort()).toEqual(["kebab-name", "onlyB", "shadowed", "x"]);
			expect(module.shadowed).toBe("entry");
			expect(result.warnings).toEqual([]);
		});

		it("forwards star exports of external packages and handles cycles", async () => {
			const { code, exports } = await build(
				{
					"src/index.ts": `export * from "./a";`,
					"src/a.ts": `
						export * from "./b";
						export * from "external-pkg";
						/** @internal */ export const secret = 1;
					`,
					"src/b.ts": `export * from "./a"; export const b = 1;`
				},
				{ external: ["external-pkg"] }
			);

			expect(exports).toContain("b");
			expect(exports).not.toContain("secret");
			expect(code).toContain(`from "external-pkg"`);
		});

		it("rewrites the entry in non-bundled builds too", async () => {
			const { code } = await build(
				{
					"src/index.ts": `export * from "./lib";\nexport { helper } from "./lib";`,
					"src/lib.ts": `/** @internal */ export const helper = 1; export const pub = 2;`
				},
				{ bundle: false }
			);

			expect(code).not.toContain("helper");
			expect(code).toContain("pub");
		});

		it("handles every entry point and every `entryPoints` shape", async () => {
			const dir = await createProject({
				"src/index.ts": `export { a, secret } from "./lib";`,
				"src/other.ts": `export { b, secret } from "./lib";`,
				"src/lib.ts": `export const a = 1; export const b = 2; /** @internal */ export const secret = 3;`
			});

			for (const entryPoints of [
				["src/index.ts", "./src/other.ts"],
				{ index: "src/index.ts", other: join(dir, "src/other.ts") },
				[
					{ in: "src/index.ts", out: "index" },
					{ in: "src/other.ts", out: "other" }
				]
			] satisfies BuildOptions["entryPoints"][]) {
				const { result } = await run(dir, { entryPoints });
				const allExports = Object.values(result.metafile.outputs).flatMap(output => output.exports);
				expect(allExports.sort()).toEqual(["a", "b"]);
			}
		});

		it("supports JS and JSX entry files", async () => {
			const js = await build(
				{ "src/index.js": `/** @internal */ export const a = 1; export const b = a;` },
				{ entryPoints: ["src/index.js"] }
			);
			const jsx = await build(
				{
					"src/index.jsx": `/** @internal */ export const h = (t) => t; export const el = <div />;`
				},
				{ entryPoints: ["src/index.jsx"], jsx: "transform", jsxFactory: "h" }
			);

			expect(js.exports).toEqual(["b"]);
			expect(jsx.exports).toEqual(["el"]);
		});

		it("supports custom tags", async () => {
			const { exports } = await build(
				{ "src/index.ts": `/** @private */ export const a = 1; /** @internal */ export const b = 2;` },
				{},
				{ tags: ["private"] }
			);

			expect(exports).toEqual(["b"]);
		});

		it("does nothing without entry files (stdin builds)", async () => {
			const result = await esbuild.build({
				stdin: { contents: `/** @internal */ export const a = 1;`, loader: "ts" },
				format: "esm",
				write: false,
				metafile: true,
				logLevel: "silent",
				plugins: [noInternalExports]
			});

			expect(Object.values(result.metafile.outputs)[0].exports).toEqual(["a"]);
		});

		it("picks up newly tagged declarations on rebuild", async () => {
			const dir = await createProject({
				"src/index.ts": `export * from "./lib";`,
				"src/lib.ts": `export const a = 1; export const b = 2;`
			});
			const context = await esbuild.context({
				absWorkingDir: dir,
				entryPoints: ["src/index.ts"],
				bundle: true,
				format: "esm",
				outdir: "out",
				write: false,
				metafile: true,
				logLevel: "silent",
				plugins: [noInternalExports]
			});

			try {
				const exportsOf = (result: Awaited<ReturnType<typeof context.rebuild>>) =>
					Object.values(result.metafile.outputs).flatMap(output => output.exports);

				expect(exportsOf(await context.rebuild()).sort()).toEqual(["a", "b"]);
				await writeFiles(dir, { "src/lib.ts": `export const a = 1; /** @internal */ export const b = 2;` });
				expect(exportsOf(await context.rebuild())).toEqual(["a"]);
			} finally {
				await context.dispose();
			}
		});

		it("logs removed exports in debug mode", async () => {
			const info = vi.spyOn(console, "info").mockImplementation(() => void 0);
			try {
				await build({ "src/index.ts": `/** @internal */ export const a = 1;` }, {}, { debug: true });
				expect(info).toHaveBeenCalledWith(expect.stringContaining("removed internal exports: a"));
			} finally {
				info.mockRestore();
			}
		});
	});

	describe("[ERROR]", () => {
		it("leaves syntax errors to esbuild", async () => {
			await expect(build({ "src/index.ts": `export const = ;` })).rejects.toThrow(/Expected identifier/u);
		});
	});
});
