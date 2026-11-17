# @esplugins/no-internal-exports

## 1.1.0

### Minor Changes

- Rewrite of the plugin on a real parser (`oxc-parser`) instead of regular expressions, plus support for more bundlers:

  - new adapters (built with unplugin): `@esplugins/no-internal-exports/vite`, `/rollup`, `/rolldown` (also tsdown),
    `/webpack`, `/rspack` and `/unplugin`; `esbuild` is now an optional peer dependency
  - follows internal elements through any depth of `export *`, `export { x } from`, `import` + `export` and aliases
  - resolves imports with the bundler's own resolver (`tsconfig` paths, aliases, other plugins)
  - returns a sourcemap for the rewritten entry file
  - edits the entry file in place instead of regenerating it (imports and other code in the entry file are kept)
  - handles every entry point, JS/JSX/TS/TSX entries, default exports, namespace re-exports and tags on single
    specifiers
  - keeps ES semantics of `export *` (shadowing, ambiguous names) and re-exports types with `export type`
  - re-builds the entry file in watch mode when a tag changes in any re-exported module
  - new `createNoInternalExports({ tags, debug })` factory; the default export works as before
  - no longer throws when a build has no entry points and no longer prints debug logs by default
  - `typescript`, `magic-regexp` and `oh-my-error` are no longer dependencies
  - requires Node.js `^20.19.0 || >=22.12.0` (`oxc-parser`, and `require()` of the ESM-only `unplugin` / `magic-string`
    in the CommonJS build)

## 1.0.0

### Patch Changes

- fix deeper checking

## 1.0.0-prerelease.2

### Minor Changes

- add `@dontexport` tag as alternative to `@internal` for types and improve regex finder

## 1.0.0-prerelease.1

### Patch Changes

- regExp for @internal multicomments

## 1.0.0-prerelease

### Major Changes

- Protecting `@internal` marked functions/variables/types from export
