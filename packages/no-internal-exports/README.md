![image](https://github.com/user-attachments/assets/140e4531-5ca1-4946-bb70-6f8a300af379)

<h1 align="center"> Esbuild @internal guard</h1>
<p align="center">no-internal-exports</p>
<p align="center">This package protect entry file against exporting <code>@internal</code> functions/types/variables.</p>

<!-- <img alt="Crates.io Size" src="https://img.shields.io/bundlephobia/size/@better/validate-npm-package-name"> -->
<hr/>

If you ever wanted to export `@internal` **Functions/Variables/Types** but you was worried about exporting that outside
with entry files <br><br> <b>Dont Worry</b> <br><br>Right know you can export them in your codebase and protect them to
not being exported in entry file.

```typescript
// index.ts (Entry file)
// @/functions - its `/src/functions/index.ts` path to export barrel
export * from "@/functions"

// functions/index.ts
export * from "./nameValidator"

// @/functions/nameValidator.ts
/** @internal */
export const MAX_LENGTH = 256 as const;
/** @internal */
export const MAX_SAFE_NAME_LENGTH = MAX_LENGTH - 6 ;

/** @internal */
export const MyErrorList = {"TOO_LONG":{...},...code}

export const nameValidator = (name:string) => {...code}
export default nameValidator;

// nameValidator.test.ts
// Importing to check that error case drop correct error
import { MyErrorList } from "@/functions/nameValidator.ts"
```

```typescript
// index.js - final build output
// Note that, every element with @internal is not exported!
export { nameValidator };
```

<hr/>

## 📜 List of Contents

- [📜 List of Contents](#-list-of-contents)
- [Install](#install)
- [Support](#support)
  - [Status](#status)
  - [Table of Support](#table-of-support)
- [Implementation](#implementation)
  - [Esbuild](#esbuild)
  - [TSUP](#tsup)
  - [Vite](#vite)
  - [Rollup](#rollup)
  - [Rolldown / tsdown](#rolldown--tsdown)
  - [Webpack](#webpack)
  - [Rspack](#rspack)
  - [Other bundlers (unplugin)](#other-bundlers-unplugin)
  - [CommonJS](#commonjs)
- [Usage](#usage)
  - [What is supported](#what-is-supported)
- [Options](#options)
- [How it works](#how-it-works)
- [Limitations](#limitations)

## Install

NPM

```bash copy
npm install @esplugins/no-internal-exports
```

PNPM

```bash copy
pnpm add @esplugins/no-internal-exports
```

Yarn

```bash copy
yarn add @esplugins/no-internal-exports
```

Your bundler is used as-is: esbuild (`>=0.18`) for the main entry, or Vite / Rollup / Rolldown / webpack / Rspack
through the subpath of the [table below](#table-of-support) (adapters are built with
[unplugin](https://github.com/unjs/unplugin)).

## Support

There you can check support for other bundlers!

### Status

| Emoji | Meaning         |
| ----- | --------------- |
| ✅    | Completed       |
| ⏸️    | Paused          |
| ❌    | Aborted         |
| 🛠️    | In Progress     |
| 💤    | Not Yet Started |
| ❓    | Not Checked     |

### Table of Support

| Platform         | Import                                    | Status |
| ---------------- | ----------------------------------------- | ------ |
| Esbuild          | `@esplugins/no-internal-exports`          | ✅     |
| TSUP             | `@esplugins/no-internal-exports`          | ✅     |
| Vite             | `@esplugins/no-internal-exports/vite`     | ✅     |
| Rollup           | `@esplugins/no-internal-exports/rollup`   | ✅     |
| Rolldown, tsdown | `@esplugins/no-internal-exports/rolldown` | ✅     |
| Webpack          | `@esplugins/no-internal-exports/webpack`  | ✅     |
| Rspack           | `@esplugins/no-internal-exports/rspack`   | ✅     |
| Parcel           | -                                         | 💤     |

Every platform marked ✅ is covered by tests running real builds, except tsup: it hands `esbuildPlugins` to esbuild,
which is tested directly.

## Implementation

### Esbuild

```typescript
import noInternalExports from "@esplugins/no-internal-exports";

await esbuild.build({
	entryPoints: ["src/index.ts"],
	// bundle: true,  Do like you want there, just example
	// outfile: "out.js", -||-
	plugins: [noInternalExports]
});
```

With [options](#options):

```typescript
import { createNoInternalExports } from "@esplugins/no-internal-exports";

await esbuild.build({
	entryPoints: ["src/index.ts"],
	plugins: [createNoInternalExports({ tags: ["internal", "private"], debug: true })]
});
```

### TSUP

```typescript
import { defineConfig } from "tsup";
import noInternalExports from "@esplugins/no-internal-exports";

export default defineConfig({
	entry: ["src/index.ts"],
	// target: "es2022",  Do like you want there, just example
	// format: ["esm"], -||-
	// clean: true, -||-
	// splitting: false, -||-
	// platform: "node", -||-
	// keepNames: true, -||-
	esbuildPlugins: [noInternalExports]
});
```

### Vite

Library mode (`build.lib`) or any build with `build.rollupOptions.input`. The plugin only runs in `vite build`.

```typescript
import { defineConfig } from "vite";
import noInternalExports from "@esplugins/no-internal-exports/vite";

export default defineConfig({
	build: { lib: { entry: "src/index.ts", formats: ["es"] } },
	plugins: [noInternalExports()]
});
```

### Rollup

Put it **before** plugins that compile TypeScript, so it sees the original source.

```typescript
import noInternalExports from "@esplugins/no-internal-exports/rollup";

export default {
	input: "src/index.ts",
	plugins: [noInternalExports() /* , typescript(), ... */]
};
```

### Rolldown / tsdown

```typescript
import { defineConfig } from "tsdown"; // or "rolldown"
import noInternalExports from "@esplugins/no-internal-exports/rolldown";

export default defineConfig({
	entry: ["src/index.ts"],
	plugins: [noInternalExports()]
});
```

### Webpack

Entry files are taken from the `entry` option. The plugin runs before your loaders (`ts-loader`, `swc-loader`, ...).

```javascript
const noInternalExports = require("@esplugins/no-internal-exports/webpack").default;

module.exports = {
	entry: "./src/index.ts",
	plugins: [noInternalExports()]
};
```

### Rspack

```javascript
const noInternalExports = require("@esplugins/no-internal-exports/rspack").default;

module.exports = {
	entry: "./src/index.ts",
	plugins: [noInternalExports()]
};
```

### Other bundlers (unplugin)

The adapters come from one [unplugin](https://github.com/unjs/unplugin) instance, which you can also use directly (e.g.
`.rsbuild()`, `.farm()`). Those bundlers are not tested.

```typescript
import { noInternalExportsUnplugin } from "@esplugins/no-internal-exports/unplugin";

noInternalExportsUnplugin.rsbuild({ tags: ["internal"] });
```

### CommonJS

```javascript
const { noInternalExports, createNoInternalExports } = require("@esplugins/no-internal-exports");
// Adapters: `require("@esplugins/no-internal-exports/<bundler>").default`
```

## Usage

Just use `@internal` in **multi-line comment** before **Function/Variable/Type**. (Like in JSDocs/TSDocs)

> [!TIP] To Typescript config you can add [`stripInternal`](https://www.typescriptlang.org/tsconfig/#stripInternal) at
> `compilerOptions` to do not emit `@internal` types in `d.ts`!

> [!TIP] alternative for Types To mark type/interface/enum as internal and avoid removing them from `d.ts` you can use
> `@dontexport`!

```ts
/** @internal */
const internalFunc1 = () => {};

/**
 * @internal */
const internalFunc2 = () => {};

/**
 * Description of the function.
 * @internal
 */
const internalFunc3 = () => {};
```

Every other module of your codebase (and your tests) can still import internal elements - only **entry files** stop
exporting them.

### What is supported

```ts
// Entry file (src/index.ts)

/** @internal */
export const local = 1; //                 ❌ removed from exports (still usable inside this file)
export * from "./functions"; //            ✅ re-exported, without internal elements
export { helper, publicFn } from "./a"; // ✅ only `publicFn` - `helper` is internal in `./a`
import { util } from "./b";
export { util }; //                        ❌ `util` is internal in `./b`

/** @internal */
export * as debug from "./debug"; //       ❌ namespace marked as internal
export {
	visible,
	/** @internal */ hidden //               ❌ tag on a single specifier
} from "./c";

/** @internal */
export default function main() {} //       ❌ default exports too
```

- Internal elements are found through any depth of `export *`, `export { x } from`, `import` + `export` and aliases
  (`export { x as y }`).
- Imports are resolved by your bundler itself, so `tsconfig` `paths` (e.g. `@/functions`), aliases, extensions and other
  plugins work out of the box.
- TS, TSX, JS, JSX, MTS/CTS and MJS/CJS files; every entry point of the build.
- Type-only exports (`interface`, `type`, `export type`) are re-exported with `export type`.
- `export *` keeps ES module semantics: local exports shadow star exports and conflicting names stay unexported.
- Watch mode: every analyzed module is a watched file, so adding/removing a tag anywhere re-builds the entry file.
- esbuild: bundled and non-bundled (`bundle: false`) builds.

## Options

Every adapter takes the same options: `createNoInternalExports(options)` for esbuild (its default export is the plugin
created with default options) and `noInternalExports(options)` for the other bundlers.

| Option  | Type       | Default                      | Description                                                 |
| ------- | ---------- | ---------------------------- | ----------------------------------------------------------- |
| `tags`  | `string[]` | `["internal", "dontexport"]` | JSDoc tags (without `@`) marking elements as not exportable |
| `debug` | `boolean`  | `false`                      | Logs which exports were removed from every entry file       |

## How it works

1. Entry files are taken from the bundler: esbuild's `entryPoints`, the `isEntry` module info in Vite / Rollup /
   Rolldown, or the `entry` option in webpack / Rspack.
2. When an entry file is loaded, the plugin parses it (and every module it re-exports from) with
   [oxc-parser](https://www.npmjs.com/package/oxc-parser) and follows each export to its original declaration. Imports
   are resolved by the bundler's own resolver.
3. Declarations with a tag in the block comment right before them are internal.
4. The entry file is edited in place (with a sourcemap): `export` keywords and specifiers of internal elements are
   removed, and an `export * from "x"` that would expose one is replaced by an explicit list of the public names.
   Everything else in the file stays untouched.

## Limitations

- A tag must be in a **block comment** (`/** @internal */` or `/* @internal */`) directly before the declaration, the
  export statement or the export specifier. Line comments (`// @internal`) are ignored.
- Modules that can't be analyzed (marked `external`, virtual modules from other plugins) are treated as having no
  internal elements. `export *` from them is kept.
- `export * as ns from "x"` exposes the whole namespace object - mark the namespace export itself as internal to hide
  it.
- esbuild: if another plugin loads the entry file itself (its own `onLoad` for that file), esbuild uses that result and
  this plugin is skipped for it.
- Rollup: plugins listed before this one see the original entry file; put it before TypeScript / Babel plugins.
- Vite: only `vite build` - the dev server has no library entry to protect.
- webpack / Rspack: only entries from the `entry` option are detected (not entries added later by other plugins).
