// Runs inside the consumer project (outside the monorepo): bundlers and the plugin resolve from its node_modules.
// Builds a copy of ./fixture with one bundler and prints the entry's export names as JSON on the last stdout line.
import { cp, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FIXTURE = join(import.meta.dirname, "fixture");

const importExports = async file => Object.keys(await import(pathToFileURL(file).href));

const runWebpackLike = async compiler =>
	new Promise((resolve, reject) => {
		compiler.run((error, stats) => {
			compiler.close(() => {});
			if (error) reject(error);
			else if (stats.hasErrors()) reject(new Error(stats.toString("errors-only")));
			else resolve();
		});
	});

const builders = {
	async esbuild(dir, plugin) {
		const esbuild = await import("esbuild");
		const result = await esbuild.build({
			absWorkingDir: dir,
			entryPoints: ["src/index.js"],
			bundle: true,
			format: "esm",
			outdir: "out",
			write: false,
			metafile: true,
			logLevel: "silent",
			plugins: [plugin]
		});
		return Object.values(result.metafile.outputs).find(output => output.entryPoint).exports;
	},

	async rollup(dir, plugin) {
		const { rollup } = await import("rollup");
		const bundle = await rollup({ input: join(dir, "src/index.js"), plugins: [plugin], onwarn: () => {} });
		const { output } = await bundle.generate({ format: "es" });
		await bundle.close();
		return output[0].exports;
	},

	async rolldown(dir, plugin) {
		const { rolldown } = await import("rolldown");
		const bundle = await rolldown({ input: join(dir, "src/index.js"), plugins: [plugin], logLevel: "silent" });
		const { output } = await bundle.generate({ format: "esm" });
		await bundle.close();
		return output[0].exports;
	},

	async vite(dir, plugin) {
		const { build } = await import("vite");
		const result = await build({
			root: dir,
			configFile: false,
			logLevel: "silent",
			plugins: [plugin],
			build: {
				write: false,
				minify: false,
				lib: { entry: join(dir, "src/index.js"), formats: ["es"], fileName: "index" }
			}
		});
		const outputs = Array.isArray(result) ? result : [result];
		return outputs[0].output.find(chunk => chunk.type === "chunk" && chunk.isEntry).exports;
	},

	async webpack(dir, plugin) {
		const { default: webpack } = await import("webpack");
		await runWebpackLike(
			webpack({
				context: dir,
				mode: "production",
				entry: "./src/index.js",
				target: "node",
				experiments: { outputModule: true },
				output: { path: join(dir, "out"), filename: "index.mjs", library: { type: "module" } },
				optimization: { minimize: false },
				plugins: [plugin]
			})
		);
		return importExports(join(dir, "out/index.mjs"));
	},

	async rspack(dir, plugin) {
		const { rspack } = await import("@rspack/core");
		await runWebpackLike(
			rspack({
				context: dir,
				mode: "production",
				entry: "./src/index.js",
				target: "node",
				output: { path: join(dir, "out"), filename: "index.mjs", module: true, library: { type: "module" } },
				optimization: { minimize: false },
				plugins: [plugin]
			})
		);
		return importExports(join(dir, "out/index.mjs"));
	}
};

/**
 * Checks the shape of a package entry module and returns a plugin instance for its bundler.
 * @param {string} entry - `index`, `unplugin`, or a bundler subpath (`vite`, ...)
 * @param {Record<string, any>} module - the module as loaded by the consumer (ESM import or CJS require)
 */
export const pickPlugin = (entry, module) => {
	if (entry === "index") {
		if (typeof module.createNoInternalExports !== "function") throw new Error("missing createNoInternalExports");
		if (typeof module.default?.setup !== "function" || module.default !== module.noInternalExports) {
			throw new Error("default export is not the noInternalExports esbuild plugin");
		}
		return module.createNoInternalExports();
	}
	if (entry === "unplugin") {
		if (module.default !== module.noInternalExportsUnplugin || typeof module.unpluginFactory !== "function") {
			throw new Error("unexpected exports of the unplugin entry");
		}
		return module.default.rollup();
	}
	if (typeof module.default !== "function") throw new Error(`default export of "${entry}" is not a plugin factory`);
	return module.default();
};

/** Builds a fresh copy of the fixture and prints `{ "exports": [...] }`. */
export const run = async (bundler, plugin, label) => {
	const dir = await mkdtemp(join(import.meta.dirname, `run-${label}-`));
	await cp(FIXTURE, dir, { recursive: true });
	const exports = await builders[bundler](dir, plugin);
	process.stdout.write(`\n${JSON.stringify({ exports: [...exports].sort() })}\n`);
};

/** Package specifier of an entry (`index` is the package root). */
export const specifierOf = entry =>
	entry === "index" ? "@esplugins/no-internal-exports" : `@esplugins/no-internal-exports/${entry}`;
