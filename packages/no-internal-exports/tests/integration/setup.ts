import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { TestProject } from "vitest/node";

//----------------------
// Types
//----------------------

declare module "vitest" {
	export interface ProvidedContext {
		/** Consumer project with the packed package installed (outside the monorepo). */
		consumerDir: string;
		/** Paths inside the published tarball. */
		tarballFiles: string[];
	}
}

interface PackResult {
	filename: string;
	files: Array<{ path: string }>;
}

//----------------------
// Constants
//----------------------

const PACKAGE_DIR = resolve(import.meta.dirname, "../..");
const DIST_DIR = join(PACKAGE_DIR, "dist");

/** Bundlers installed in the consumer project, at the versions the package is developed against. */
const BUNDLERS = ["esbuild", "vite", "rollup", "rolldown", "webpack", "@rspack/core"] as const;

//----------------------
// Helpers
//----------------------

const exec = (command: string, args: string[], cwd: string): string => {
	const options = {
		cwd,
		encoding: "utf8",
		// `dist/.npmrc` references `${NPM_TOKEN}`; npm fails on undefined env variables in `.npmrc`.
		env: { ...process.env, NPM_TOKEN: process.env.NPM_TOKEN ?? "" }
	} as const;
	// `npm` / `pnpm` are `.cmd` shims on Windows and need a shell; with a shell, Node wants one quoted command string.
	const result =
		process.platform === "win32"
			? spawnSync([command, ...args.map(arg => `"${arg}"`)].join(" "), { ...options, shell: true })
			: spawnSync(command, args, options);
	if (result.status !== 0) {
		throw new Error(`\`${command} ${args.join(" ")}\` failed in ${cwd}:\n${result.stdout}\n${result.stderr}`);
	}
	return result.stdout;
};

//----------------------
// Setup
//----------------------

/**
 * Packs `dist/` like `npm publish` would, then installs the tarball into a fresh project in the OS temp dir.
 * Being outside the monorepo matters: nothing can resolve from the workspace `node_modules` by accident.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
	if (!existsSync(join(DIST_DIR, "package.json"))) {
		throw new Error("dist/ is missing: run `pnpm build:npm` first (or use `pnpm test:integration`).");
	}

	const root = await mkdtemp(join(tmpdir(), "no-internal-exports-integration-"));
	const output = exec("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], DIST_DIR);
	const [packed] = JSON.parse(output.slice(output.indexOf("["))) as PackResult[];

	const consumerDir = join(root, "consumer");
	await cp(join(import.meta.dirname, "consumer"), consumerDir, { recursive: true });

	const { devDependencies } = JSON.parse(await readFile(join(PACKAGE_DIR, "package.json"), "utf8")) as {
		devDependencies: Record<string, string>;
	};
	const dependencies: Record<string, string> = {
		"@esplugins/no-internal-exports": `file:${join(root, packed.filename).replaceAll("\\", "/")}`
	};
	for (const bundler of BUNDLERS) dependencies[bundler] = devDependencies[bundler];

	await writeFile(
		join(consumerDir, "package.json"),
		JSON.stringify({ name: "consumer", private: true, dependencies }, undefined, "\t")
	);
	exec("pnpm", ["install", "--prefer-offline", "--ignore-scripts", "--ignore-workspace"], consumerDir);

	project.provide("consumerDir", consumerDir);
	project.provide(
		"tarballFiles",
		packed.files.map(file => file.path)
	);

	return async () => {
		await rm(root, { recursive: true, force: true });
	};
}
