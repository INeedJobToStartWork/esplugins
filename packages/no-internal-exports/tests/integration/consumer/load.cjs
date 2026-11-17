// Loads the plugin like a CommonJS consumer: `require` resolves through the package `exports` ("require" condition).
// Usage: node load.cjs <entry> <bundler>
const [entry, bundler] = process.argv.slice(2);

const main = async () => {
	const { pickPlugin, run, specifierOf } = await import("./harness.mjs");
	const module = require(specifierOf(entry));
	await run(bundler, pickPlugin(entry, module), `${entry}-cjs`);
};

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
