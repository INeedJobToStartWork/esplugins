# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`esplugins` is a pnpm + Turborepo monorepo of community esbuild plugins (not affiliated with official esbuild). Packages are published to npm under the `@esplugins/` scope. Currently the only published package is `packages/no-internal-exports` (workspace name `@packages/no-internal-exports`).

Workspace layout (`pnpm-workspace.yaml`): `packages/**` (published plugins), `configs/**` (shared internal configs, e.g. `@configs/vitest`), `apps/**`, `benchmarks/**`, and `turbo/generators/templates/**` (scaffolding templates — these are workspace members too, but contain Handlebars placeholders and cannot be built/packed).

Requires Node `>=26` (`.nvmrc`) and pnpm (version pinned in root `packageManager`).

## Commands

Root scripts fan out through Turbo to every package's script of the same name:

```bash
pnpm install
pnpm build:prod       # turbo build:prod (packages have build:dev / build:prod / build:npm, no plain `build`)
pnpm build:npm        # what CI runs; filter out templates:
pnpm build:npm --filter='!./turbo/generators/templates/**'
pnpm lint / pnpm lint:fix
pnpm format / pnpm format:check
pnpm test             # turbo test (vitest, persistent/watch by default)
pnpm turbo run test -- --run   # single non-watch run (what pre-push does)
pnpm test:integration          # build:npm + tests of the packed package (not run by pre-push / CI)
```

Target one package with `--filter`, e.g. `pnpm turbo run lint --filter=@packages/no-internal-exports`, or run scripts directly inside the package dir (`pnpm build:npm`, `pnpm lint`, `pnpm test`). Turbo refuses to run at all if two workspace packages share a `name`.

Run a single test file: `cd packages/<pkg> && pnpm vitest run path/to/file.test.ts` (or `-t "<test name>"` to filter by name).

Scaffold a new package or regenerate root repo files: `pnpm turbo gen` (generators "Package" and "REPO customization" in `turbo/generators/config.ts`; new packages are created from `turbo/generators/templates/packages/test-package-cli` into `packages/<dash-case-name>`).

## Git hooks, commits, releases

- **pre-commit**: `lint-staged` (per-package config runs format, `lint:fix`, `lint`).
- **pre-push**: `turbo lint`, `turbo format:check`, `turbo test -- --run`.
- Commit messages use [commitsmile](https://github.com/INeedJobToStartWork/Commit-Smile) (`commitSmile.ts`): emoji-prefixed conventional style with a workspace/package scope, e.g. `🎉 Feat(@esplugins/no-internal-exports): ...`, `🐛 Fix(...)`, `⚙️ Chore(environment): ...`.
- Versioning/publishing via Changesets (`pnpm changeset`, `pnpm npm:version`, `pnpm npm:publish`). The `publish.yml` workflow on `main` opens a version PR or publishes to npm.

## Package build conventions

Each package publishes from `dist/`, not the package root (`publishConfig.directory: "dist"`):

- Packages are named `@packages/<name>` inside the workspace (use that in `--filter` and changesets); `clean-package.config.json` renames them to the published `@esplugins/<name>` at pack time.
- `npm:prepack` runs `clean-package`, which **temporarily rewrites `package.json`** (publish name, no devDependencies, injected `exports`); `npm:postpack` restores it from `package.json.backup`. If `build:npm` fails midway, restore with `mv package.json.backup package.json` — **don't run any `pnpm` command first**: pnpm would reinstall from the rewritten manifest and uninstall the devDependencies (including `clean-package` itself).
- Builds use **tsdown** (`config/tsdownrc/tsdown.{dev,prod,npm}.ts`, loaded via `--config-loader unrun`, so `unrun` must be a devDependency). `build:npm` also runs attw + publint. tsdown copies `package.json`, `README.md`, `LICENSE`, `.npmrc`, `.npmignore` into `dist/`.
- Source uses an `@/*` → `src/*` path alias (tsconfig `paths`, mirrored in `vitest.config.ts`).
- `tsconfig` has `stripInternal: true`: any declaration whose leading comment merely *contains* the text `@internal` disappears from the emitted `.d.ts` — don't write that literal in docs of public API.
- Don't set `preserveSymlinks: true` (the template had it): under pnpm it hides transitive type packages and typed imports turn into `any`, which floods typescript-eslint with `no-unsafe-*` errors.
- Lint/format/TS config come from the author's shared packages `@ineedj/eslintrc`, `@ineedj/prettierrc`, `@ineedj/tsconfig`. Custom rule namespaces like `@EslintSecurity/...`, `@EslintUnicorn/...`, `@EslintOptRegConf/...` come from `@ineedj/eslintrc`. Known quirks: `@EslintUnicorn/prefer-spread` and `@EslintPrefArrayFunc/prefer-array-from` contradict each other for `Set` → array (disable one inline); `@EslintOptRegConf/optimize-regex` crashes on `p{...}` inside a regex literal's character class (eslint-disable doesn't help — use `new RegExp`).
- TypeScript version split: the root workspace uses TS 7, but `typescript-eslint` needs TS 6, so `pnpm-workspace.yaml` uses `packageExtensions` to pin TS 6 inside the `@ineedj/eslintrc` tree. Don't "fix" this by unifying versions. TS 7 has no JS compiler API, so runtime code must not depend on `typescript`.
- Type-check manually with `pnpm exec tsc --noEmit -p . --skipLibCheck` (there is no script; without `--skipLibCheck` vitest's own `.d.ts` fails against the installed vite).

## `no-internal-exports` architecture

A bundler plugin that removes exports marked `@internal` / `@dontexport` (configurable `tags`) from **entry files** only, so internal helpers stay importable across the codebase and in tests. Source is layered: `src/entries/` (public API, one file per package subpath) → `src/adapters/` (bundler integration, grouped by API family) → `src/core/` (bundler-independent). Every `src/entries/<name>.ts` is a tsdown entry (`ENTRIES` in `tsdown.base.ts`) *and* a subpath in `clean-package.config.json` `exports` — keep the three in sync when adding a bundler; `dist/` file names come from the entry keys, not from `src` paths. `entries/index.ts` = esbuild (`noInternalExports` plugin object as default, `createNoInternalExports(options)`); `entries/{vite,rollup,rolldown,webpack,rspack,unplugin}.ts` = unplugin adapters (default export = factory). The root entry must not import `unplugin`, so esbuild users don't load it.

- `src/core/entryRewriter.ts` — bundler-independent core used by every adapter: per-build caches (`reset()` on build start), `rewrite(path, code, resolve)` where `resolve` is the bundler's resolver; collects `watchFiles` (every analyzed module, so tag changes deep in the graph rebuild the entry).
- `src/adapters/esbuild/plugin.ts` (+ `entryPoints.ts`) — esbuild: `onStart` resolves entry points with `build.resolve`; `onLoad` for those paths returns the rewritten code (always, even unchanged, so `watchFiles` registers).
- `src/adapters/unplugin/factory.ts` — assembles the unplugin instance. unplugin's unified context has no `this.resolve`/`getModuleInfo`, so Rollup/Vite/Rolldown get native hooks (`adapters/rollup/hooks.ts`) via the `rollup`/`vite`/`rolldown` overrides (unplugin `Object.assign`s them over the unified hooks): entries via `getModuleInfo(id).isEntry`, resolution via `this.resolve(..., { skipSelf: true })`. Vite uses `apply: "build"`. webpack/Rspack use the unified `transform` (`adapters/webpack/transform.ts`, runs as a loader, `enforce: "pre"`): entries = `compiler.options.entry` resolved with `loaderContext.getResolve()`, compared to `loaderContext.resourcePath`. Helpers shared by both families live in `adapters/shared.ts`.
- `src/core/parseModule.ts` — parses with `oxc-parser` (offsets are UTF-16, safe for `string.slice`) into a `ModuleRecord`: exports, re-exports, `export *` stars, import bindings, and local declarations. A declaration is tagged when a tagged **block** comment lies between the previous statement and it (also between `export` and the declaration, or before a single specifier).
- `src/core/exportGraph.ts` — follows an export through re-exports / `import`+`export` / stars to its origin, with ES semantics: explicit exports shadow star exports, and star names from different origins are ambiguous (not exported). Note: esbuild's **metafile** still lists ambiguous names even though its output omits them — tests assert on the module itself for that case.
- `src/core/rewriteEntry.ts` — position-preserving edits (MagicString, with sourcemap) to the entry source: strips `export` from internal declarations, removes internal specifiers, and, if any `export *` would expose an internal name, expands **all** analyzable entry stars into explicit `export { } from` / `export type { } from` lists (expanding only some would un-hide ambiguous names). Opaque nested stars with bare specifiers are forwarded as `export * from "pkg"`.
- Tests run real builds on temp projects: `src/adapters/esbuild/plugin.test.ts` (esbuild, checks `metafile` exports or imports the bundle via a `data:` URL) and `src/adapters/unplugin/factory.test.ts` (Rollup, Rolldown, tsdown, Vite, webpack, Rspack — imports the public `@/entries/*`). Plain Rollup has no Node-style resolution, so its fixtures use full `.js` import paths; webpack/Rollup fixtures are JS because neither parses TS without extra plugins.
- Integration tests (`tests/integration/`, own `vitest.integration.config.ts`, excluded from the normal `vitest.config.ts`): `setup.ts` runs `npm pack` in `dist/`, installs the tarball plus the bundlers (devDependency versions) into a project in the OS temp dir — deliberately outside the monorepo so nothing resolves from workspace `node_modules` — then `package.test.ts` spawns `consumer/load.mjs` / `load.cjs` per entry (ESM `import` and CJS `require` by package name) to run a real build of `consumer/fixture`, and checks tarball contents and the published `package.json`. `consumer/**` is plain consumer JS, ignored by ESLint. Adding an entry means adding it to `ENTRIES` in `package.test.ts` (and `pickPlugin` in `consumer/harness.mjs` if its exports differ).
- Build: bundlers are devDependencies referenced only by types, so `tsdown.base.ts` marks them `deps.neverBundle` — otherwise the `.d.ts` bundler tries to inline webpack/vite/postcss types and fails.
