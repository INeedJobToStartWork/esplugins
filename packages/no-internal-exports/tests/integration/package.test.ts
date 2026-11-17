import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, inject, it } from "vitest";

//----------------------
// Constants
//----------------------

const consumerDir = inject("consumerDir");
const tarballFiles = inject("tarballFiles");

/** Package entry (`index` = package root) -> bundler used to build the fixture with it. */
const ENTRIES = {
	index: "esbuild",
	unplugin: "rollup",
	vite: "vite",
	rollup: "rollup",
	rolldown: "rolldown",
	webpack: "webpack",
	rspack: "rspack"
} as const;

/** Public exports of the fixture: everything tagged `@internal` must be gone. */
const EXPECTED_EXPORTS = ["local", "pub", "visible"];

//----------------------
// Helpers
//----------------------

const execFileAsync = promisify(execFile);

/** Runs a consumer script in its own Node process and returns the export names it printed. */
const buildAsConsumer = async (script: "load.cjs" | "load.mjs", entry: string, bundler: string) => {
	const { stdout } = await execFileAsync(process.execPath, [join(consumerDir, script), entry, bundler], {
		cwd: consumerDir,
		maxBuffer: 10 * 1024 * 1024
	});
	const lastLine = stdout.trim().split("\n").at(-1) ?? "";
	return (JSON.parse(lastLine) as { exports: string[] }).exports;
};

//----------------------
// Tests
//----------------------

describe("published package", () => {
	describe("[PASS]", () => {
		it("tarball contains every entry in ESM, CJS and both type flavours", () => {
			for (const entry of Object.keys(ENTRIES)) {
				for (const extension of [".mjs", ".cjs", ".d.mts", ".d.cts"]) {
					expect(tarballFiles).toContain(`${entry}${extension}`);
				}
			}
			expect(tarballFiles).toEqual(expect.arrayContaining(["package.json", "README.md", "LICENSE"]));
		});

		it("tarball contains no sources, configs or secrets", () => {
			const unexpected = tarballFiles.filter(
				file =>
					file.startsWith("src/") ||
					file.startsWith("config/") ||
					file.startsWith("tests/") ||
					file.includes(".npmrc") ||
					file.includes(".env") ||
					(file.endsWith(".ts") && !file.endsWith(".d.mts") && !file.endsWith(".d.cts"))
			);
			expect(unexpected).toEqual([]);
		});

		it("package.json is the publish version", async () => {
			const manifest = JSON.parse(
				await readFile(join(consumerDir, "node_modules/@esplugins/no-internal-exports/package.json"), "utf8")
			) as Record<string, unknown>;

			expect(manifest.name).toBe("@esplugins/no-internal-exports");
			expect(manifest).not.toHaveProperty("private");
			expect(manifest).not.toHaveProperty("devDependencies");
			expect(manifest).not.toHaveProperty("lint-staged");
			expect(Object.keys(manifest.dependencies as object).sort()).toEqual(["magic-string", "oxc-parser", "unplugin"]);
			expect(manifest.peerDependenciesMeta).toEqual({ esbuild: { optional: true } });
			expect(Object.keys(manifest.exports as object).sort()).toEqual(
				[...Object.keys(ENTRIES).map(entry => (entry === "index" ? "." : `./${entry}`)), "./package.json"].sort()
			);
		});
	});

	// Each case spawns a real build in a separate process, so they run concurrently.
	describe.concurrent("[PASS] every entry works from the installed package", () => {
		for (const [entry, bundler] of Object.entries(ENTRIES)) {
			const specifier =
				entry === "index" ? "@esplugins/no-internal-exports" : `@esplugins/no-internal-exports/${entry}`;

			it(`import "${specifier}" (ESM) + ${bundler}`, async () => {
				expect(await buildAsConsumer("load.mjs", entry, bundler)).toEqual(EXPECTED_EXPORTS);
			});

			it(`require("${specifier}") (CJS) + ${bundler}`, async () => {
				expect(await buildAsConsumer("load.cjs", entry, bundler)).toEqual(EXPECTED_EXPORTS);
			});
		}
	});
});
