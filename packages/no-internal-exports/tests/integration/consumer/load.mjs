// Loads the plugin like an ESM consumer: `import` resolves through the package `exports` ("import" condition).
// Usage: node load.mjs <entry> <bundler>
import { pickPlugin, run, specifierOf } from "./harness.mjs";

const [entry, bundler] = process.argv.slice(2);
const module = await import(specifierOf(entry));
await run(bundler, pickPlugin(entry, module), `${entry}-esm`);
