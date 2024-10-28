import type { PluginBuild } from "esbuild";

export const findEntryPoint = (builds: PluginBuild): string => {
	if (Array.isArray(builds.initialOptions.entryPoints)) {
		const firstEntry = builds.initialOptions.entryPoints[0];
		return typeof firstEntry === "object" ? firstEntry.in : firstEntry;
	}
	return Object.entries(builds.initialOptions.entryPoints as Record<string, unknown>)[0][0];
};

export default findEntryPoint;
