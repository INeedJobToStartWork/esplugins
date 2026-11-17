# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`esplugins` is a pnpm + Turborepo monorepo of community esbuild plugins (not affiliated with official esbuild). Packages are published to npm under the `@esplugins/` scope. Currently the only published package is `packages/no-internal-exports`.

Workspace layout (`pnpm-workspace.yaml`): `packages/**` (published plugins), `configs/**` (shared internal configs, e.g. `@configs/vitest`), `apps/**`, `benchmarks/**`, and `turbo/generators/templates/**` (scaffolding templates — these are workspace members too, but contain Handlebars placeholders and cannot be built/packed).

Requires Node `>=26` (`.nvmrc`) and pnpm (version pinned in root `packageManager`).

## Commands

Root scripts fan out through Turbo to every package's script of the same name:

```bash
pnpm install
pnpm build            # turbo build
pnpm build:npm        # what CI runs; filter out templates:
pnpm build:npm --filter='!./turbo/generators/templates/**'
pnpm lint / pnpm lint:fix
pnpm format / pnpm format:check
pnpm test             # turbo test (vitest, persistent/watch by default)
pnpm turbo run test -- --run   # single non-watch run (what pre-push does)
```

Target one package with `--filter`, e.g. `pnpm turbo run lint --filter=@esplugins/no-internal-exports`, or run scripts directly inside the package dir (`pnpm build`, `pnpm dev`, `pnpm lint`).

Run a single test file: `cd packages/<pkg> && pnpm vitest run path/to/file.test.ts` (or `-t "<test name>"` to filter by name).

Scaffold a new package or regenerate root repo files: `pnpm turbo gen` (generators "Package" and "REPO customization" in `turbo/generators/config.ts`; new packages are created from `turbo/generators/templates/packages/test-package-cli` into `packages/<dash-case-name>`).

## Git hooks, commits, releases

- **pre-commit**: `lint-staged` (per-package config runs format, `lint:fix`, `lint`).
- **pre-push**: `turbo lint`, `turbo format:check`, `turbo test -- --run`.
- Commit messages use [commitsmile](https://github.com/INeedJobToStartWork/Commit-Smile) (`commitSmile.ts`): emoji-prefixed conventional style with a workspace/package scope, e.g. `🎉 Feat(@esplugins/no-internal-exports): ...`, `🐛 Fix(...)`, `⚙️ Chore(environment): ...`.
- Versioning/publishing via Changesets (`pnpm changeset`, `pnpm npm:version`, `pnpm npm:publish`). The `publish.yml` workflow on `main` opens a version PR or publishes to npm.

## Package build conventions

Each package publishes from `dist/`, not the package root (`publishConfig.directory: "dist"`):

- `npm:prepack` runs `clean-package`, which **temporarily rewrites `package.json`** (removes devDependencies/lint-staged, injects `exports`, per `clean-package.config.json`); `npm:postpack` restores it. If a build is interrupted, check that `package.json` was restored.
- The prod bundler config copies `package.json`, `README.md`, `LICENSE`, `.npmrc`, `.npmignore` into `dist/`.
- Source uses an `@/*` → `src/*` path alias (tsconfig `paths`), resolved at bundle time.
- Lint/format/TS config come from the author's shared packages `@ineedj/eslintrc`, `@ineedj/prettierrc`, `@ineedj/tsconfig`. Custom rule namespaces like `@EslintSecurity/...`, `@EslintUnicorn/...`, `@EslintOptRegConf/...` come from `@ineedj/eslintrc`.
- `no-internal-exports` uses **tsup** (`config/tsuprc/tsup.{base,dev,prod}.ts`); the newer generator template uses **tsdown** (`config/tsdownrc/`) with `build:dev`/`build:prod`/`build:npm` scripts and `@configs/vitest`.
- TypeScript version split: the root workspace uses TS 7, but `typescript-eslint` needs TS 6, so `pnpm-workspace.yaml` uses `packageExtensions` to pin TS 6 inside the `@ineedj/eslintrc` tree. Don't "fix" this by unifying versions.

## `no-internal-exports` architecture

An esbuild `Plugin` (`src/index.ts`) that strips symbols marked `/** @internal */` or `/** @dontexport */` from the **entry file's** exports, so internal helpers can still be exported across the codebase (e.g. for tests) without leaking from the package's public API. It is entirely regex-based — no AST.

Two phases:

1. **`onStart`** — finds the first entry point (`utils/entryPoint.ts`), locates/parses `tsconfig` via the TypeScript API (`utils/findTsConfigPath.ts`, `utils/parseCompilerOptions.ts`), then recursively walks `import`/`export ... from` statements starting at the entry file, collecting names declared after an `@internal`/`@dontexport` JSDoc block into a `Set`. Import specifiers starting with `@` are treated as tsconfig path aliases (`functions/resolvePathFromAlias.ts`); others are resolved relative to the file. `functions/tryFile.ts` resolves extensionless paths and barrel `index.*` files.
2. **`onLoad`** — only for the entry file: rewrites its source by re-emitting local `export` declarations without `export`, then appending an `export { ... }` list minus internal names; `export * from "x"` lines are expanded (via `functions/findAllExports.ts`, which recursively follows nested star exports) into explicit `export { a, b } from "x"` lists that exclude internal names. Returns the result with `loader: "ts"`.

Note: internal names are tracked globally by identifier, so any symbol sharing a name with an `@internal` one anywhere in the reachable graph is also dropped. The prod build sets `drop: ["console"]`, so the plugin's `console.log` debug output only appears in dev builds.
