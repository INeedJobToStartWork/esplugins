![image](https://github.com/user-attachments/assets/140e4531-5ca1-4946-bb70-6f8a300af379)

<h1 align="center"> Esbuild @internal guard</h1>
<p align="center">no-internal-exports</p>
<p align="center">This package protect entry file against exporting <code>@internal</code> functions/types/variables.</p>

<!-- <img alt="Crates.io Size" src="https://img.shields.io/bundlephobia/size/@better/validate-npm-package-name"> -->
<hr/>

If you ever wanted to export `@internal` **Functions/Variables/Types** but you was worried about exporting that outside with entry files <br><br> <b>Dont Worry</b> <br><br>Right know you can export them in your codebase and protect them to not being exported in entry file.

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
- [Usage](#usage)

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

| Platform | NPM | Status       |
| -------- | --- | ------------ |
| Esbuild  | -   | ✅           |
| TSUP     | -   | ✅           |
| Vite     | -   | 💤 \|\| ✅❓ |
| Webpack  | -   | 💤           |
| Rollup   | -   | 💤           |
| Parcel   | -   | 💤           |
| Rollup   | -   | 💤           |

## Implementation

### Esbuild

```typescript
import noInternalExport from "@esplugins/no-internal-exports";

return esbuild.build({
  entryPoints: ["src/index.ts"],
  // bundle: true,  Do like you want there, just example
  // outfile: "out.js", -||-
  plugins: [noInternalExport],
});
```

### TSUP

```typescript
import { defineConfig } from "tsup";
import noInternalExport from "@esplugins/no-internal-exports";

export default defineConfig({
  entry: ["src/index.ts"],
  // target: "es2022",  Do like you want there, just example
  // format: ["esm"], -||-
  // clean: true, -||-
  // splitting: false, -||-
  // platform: "node", -||-
  // keepNames: true, -||-
  esbuildPlugins: [noInternalExport],
});
```

## Usage

Just use `@internal` in **multi-line comment** before **Function/Variable/Type**.
(Like in JSDocs/TSDocs)

> [!TIP]
> To Typescript config you can add [`stripInternal`](https://www.typescriptlang.org/tsconfig/#stripInternal) at `compilerOptions` to do not emit `@internal` types in `d.ts`!

```ts
/** @internal */
const internalFunc1 = () => {};

/**
 * @internal */
const internalFunc2 = () => {};

/**
 * @internal
 */
const internalFunc3 = () => {};
```
