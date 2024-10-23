/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @EslintUnicorn/no-null */
/* eslint-disable complexity */
import type { Plugin } from "esbuild";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  parseJsonConfigFileContent,
  findConfigFile,
  sys,
  readConfigFile,
} from "typescript";
import type { IMyError, TMyErrorList } from "oh-my-error";
import { myError } from "oh-my-error";

//----------------------
// Errors
//----------------------

const MyErrorList = {
  NO_ENTRY_POINT: {
    code: "NO_ENTRY_POINT",
    name: "No Entry Point",
    message: "No Entry Point been founded",
    hint: "Setup EntryPoint at your esbuild/tsup config!",
  } satisfies IMyError,
  COULDNT_FIND_EXPORTS: {
    code: "COULDNT_FIND_EXPORTS",
    name: "Couldnt Find Exports",
    message: "Coudlnt find Exports",
  } satisfies IMyError,
} as const satisfies TMyErrorList;

//----------------------
// Functions
//----------------------

function tryFile(basePath: string): string | null {
  const extensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mts",
    ".mjs",
    ".cts",
    ".cjs",
  ];

  if (existsSync(basePath) && statSync(basePath).isFile()) {
    return basePath;
  }

  for (const ext of extensions) {
    const pathWithExt = basePath + ext;
    if (existsSync(pathWithExt) && statSync(pathWithExt).isFile()) {
      return pathWithExt;
    }
  }

  if (existsSync(basePath) && statSync(basePath).isDirectory()) {
    for (const ext of extensions) {
      const indexPath = join(basePath, `index${ext}`);
      if (existsSync(indexPath) && statSync(indexPath).isFile()) {
        return indexPath;
      }
    }
  }

  return null;
}

function resolvePathFromAlias(
  importPath: string,
  compilerOptions: any
): string | null {
  if (!compilerOptions?.paths) return null;

  for (const [alias, paths] of Object.entries(compilerOptions.paths)) {
    const aliasPattern = alias.replaceAll("*", "(.*)");
    const match = new RegExp(`^${aliasPattern}$`).exec(importPath);

    if (match) {
      const [_, rest] = match;
      const resolvedPath = (paths as string[])[0].replace("*", rest);
      const fullPath = resolve(
        process.cwd(),
        compilerOptions.baseUrl || ".",
        resolvedPath
      );
      const file = tryFile(fullPath);
      if (file) return file;
    }
  }

  return null;
}

const findAllExports = (path: string, compilerOptions: any) => {
  const result = {
    filename: path.split("/").pop()?.split(".")[0] || "",
    fileExports: [] as string[],
    starExports: [] as Array<{ fileExports: string[]; from: string }>,
  };

  try {
    const resolvedFilePath = tryFile(path);
    if (!resolvedFilePath) {
      throw new Error(`Could not find file: ${path}`);
    }

    const content = readFileSync(resolvedFilePath, "utf8");
    const exportRegex =
      /export\s+(const|let|var|function|class|interface|type|enum)\s+([$A-Z_a-z][\w$]*)/gu;
    const namedExportRegex = /export\s*{\s*([^}]+)}/g;
    const starExportRegex = /export\s*\*\s*from\s*["'](.*)["']/gu;

    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      result.fileExports.push(match[2]);
    }

    while ((match = namedExportRegex.exec(content)) !== null) {
      const exports = match[1].split(",").map((exp) => {
        const trimmed = exp.trim();
        const asMatch = /(\w+)\s+as\s+(\w+)/u.exec(trimmed);
        return asMatch ? asMatch[2] : trimmed;
      });
      result.fileExports.push(...exports);
    }

    while ((match = starExportRegex.exec(content)) !== null) {
      const sourcePath = match[1];
      let resolvedPath = sourcePath;

      if (compilerOptions && sourcePath.startsWith("@")) {
        const resolved = resolvePathFromAlias(sourcePath, compilerOptions);
        if (resolved) {
          resolvedPath = resolved;
        }
      } else {
        resolvedPath = resolve(dirname(path), sourcePath);
      }

      try {
        const nestedExports = findAllExports(resolvedPath, compilerOptions);
        result.starExports.push({
          from: sourcePath,
          fileExports: [
            ...nestedExports.fileExports,
            ...nestedExports.starExports.flatMap((exp) => exp.fileExports),
          ],
        });
      } catch (error) {
        console.error(
          `Error analyzing nested exports from ${resolvedPath}:`,
          error
        );
      }
    }
  } catch (error) {
    console.error(`Error analyzing exports in ${path}:`, error);
  }

  return result;
};

//----------------------
// Plugin
//----------------------

export const noInternalExports: Plugin = {
  name: "no-internal-exports",
  setup(build) {
    let internalFunctions = new Set<string>();
    let entryPoint: string;
    let entryPath: string;
    let tsConfigPath: string | undefined;
    let compilerOptions: any;

    build.onStart(async () => {
      if (!build.initialOptions.entryPoints?.length) {
        console.error(MyErrorList.NO_ENTRY_POINT);
        throw myError(MyErrorList.NO_ENTRY_POINT);
      }

      entryPoint = build.initialOptions.entryPoints[0];
      entryPath = resolve(process.cwd(), entryPoint);
      tsConfigPath =
        build.initialOptions.tsconfig ??
        findConfigFile(process.cwd(), sys.fileExists, "tsconfig.json") ??
        void 0;
      compilerOptions = tsConfigPath
        ? parseJsonConfigFileContent(
            readConfigFile(tsConfigPath, sys.readFile).config,
            sys,
            dirname(tsConfigPath)
          ).options
        : void 0;

      const visitedFiles = new Set<string>();

      const scanForInternals = async (filePath: string) => {
        const resolvedPath = tryFile(filePath);
        if (!resolvedPath || visitedFiles.has(resolvedPath)) return;

        visitedFiles.add(resolvedPath);
        const source = readFileSync(resolvedPath, "utf8");
        const INTERNAL_REGEX =
          /(?:\/\*\*?[\s*]*@internal[\s*]*\*\/|\/\/\s*@internal)\s*(?:export\s+)?(?:function|const|let|var|class|type|interface)?\s*(\w+)/g;

        let match;
        while ((match = INTERNAL_REGEX.exec(source)) !== null) {
          const functionName = match[1];
          internalFunctions.add(functionName);
          console.log(
            `Found internal Function "${functionName}" in ${relative(
              process.cwd(),
              resolvedPath
            )}`
          );
        }

        const importRegex = /(?:import|export)\s+.*?from\s+["']([^"']+)["']/g;
        while ((match = importRegex.exec(source)) !== null) {
          const importPath = match[1];
          let resolvedImportPath = importPath;

          if (compilerOptions && importPath.startsWith("@")) {
            const resolved = resolvePathFromAlias(importPath, compilerOptions);
            if (resolved && !visitedFiles.has(resolved)) {
              resolvedImportPath = resolved;
              await scanForInternals(resolvedImportPath);
            }
          } else {
            try {
              resolvedImportPath = resolve(dirname(resolvedPath), importPath);
              await scanForInternals(resolvedImportPath);
            } catch {
              console.error(`Could not resolve import path: ${importPath}`);
            }
          }
        }
      };

      await scanForInternals(entryPath);
    });

    build.onLoad(
      { filter: /\.(js|ts|jsx|mts|mjs|cts|cjs|tsx)$/ },
      async (args) => {
        try {
          if (args.path === entryPath) {
            const source = readFileSync(args.path, "utf8");
            const exportedNames = new Set();
            // eslint-disable-next-line @EslintUnicorn/no-keyword-prefix
            let newSource = "";

            // 1. Najpierw zbierz wszystkie deklaracje i ich pozycje
            const declarations = [];
            const exportRegex =
              /export\s+(const|let|var|function|class|interface|type|enum)\s+([$A-Z_a-z][\w$]*)[^;{]*(?:{[^}]*}|=[^;]*|[^;{]*)(?:;|\n|$)/g;
            let match;

            const sourceWithoutStarExports = source.replaceAll(
              /export\s*\*\s*from\s*["'][^"']+["'];?\s*/g,
              ""
            );

            while (
              (match = exportRegex.exec(sourceWithoutStarExports)) !== null
            ) {
              const exportName = match[2];
              const fullMatch = match[0];
              const isInternal = internalFunctions.has(exportName);

              if (!isInternal) {
                exportedNames.add(exportName);
              }

              // Zawsze usuwaj 'export' z deklaracji
              declarations.push({
                name: exportName,
                content: fullMatch.replace("export ", ""),
              });
            }

            // 2. Przetwórz export *
            const starExportRegex = /export\s*\*\s*from\s*["'](.*)["']/g;
            const moduleExports = new Map(); // Zmiana na Map aby przechowywać source path

            while ((match = starExportRegex.exec(source)) !== null) {
              const sourcePath = match[1];
              let resolvedPath = sourcePath;

              if (compilerOptions && sourcePath.startsWith("@")) {
                const resolved = resolvePathFromAlias(
                  sourcePath,
                  compilerOptions
                );
                if (resolved) {
                  resolvedPath = resolved;
                }
              } else {
                resolvedPath = resolve(dirname(args.path), sourcePath);
              }

              try {
                const exports = findAllExports(resolvedPath, compilerOptions);
                const safeExports = [
                  ...exports.fileExports,
                  ...exports.starExports.flatMap((star) => star.fileExports),
                ].filter((exp) => !internalFunctions.has(exp));

                for (const exp of safeExports) {
                  // Zapisz export wraz ze ścieżką źródłową
                  moduleExports.set(exp, sourcePath);
                }
              } catch (error) {
                console.error(
                  `Error processing exports from ${resolvedPath}:`,
                  error
                );
              }
            }

            // 3. Złóż finalny kod
            // Najpierw dodaj wszystkie deklaracje bez słowa 'export'
            newSource = declarations.map((d) => d.content).join("\n\n");

            // Grupuj zewnętrzne exporty według ich źródła
            const externalExportsBySource = new Map();
            for (const [exportName, sourcePath] of moduleExports.entries()) {
              if (
                !internalFunctions.has(exportName) &&
                !exportedNames.has(exportName)
              ) {
                if (!externalExportsBySource.has(sourcePath)) {
                  externalExportsBySource.set(sourcePath, []);
                }
                externalExportsBySource.get(sourcePath).push(exportName);
              }
            }

            // Najpierw dodaj lokalne exporty
            const localExports = [...exportedNames].filter(
              (name) => !internalFunctions.has(name)
            );
            if (localExports.length > 0) {
              newSource += `\n\nexport {\n  ${localExports.join(",\n  ")}\n};`;
            }

            // Następnie dodaj zewnętrzne exporty, pogrupowane według źródła
            for (const [
              sourcePath,
              exports,
            ] of externalExportsBySource.entries()) {
              if (exports.length > 0) {
                newSource += `\n\nexport {\n  ${exports.join(
                  ",\n  "
                )}\n} from '${sourcePath}';`;
              }
            }

            console.log("Generated source:", newSource);
            console.log("Local exports:", localExports);
            console.log(
              "External exports by source:",
              Object.fromEntries(externalExportsBySource)
            );

            return {
              contents: newSource,
              loader: "ts",
            };
          }
        } catch (error) {
          console.error("Error in onLoad:", error);
        }

        return void 0;
      }
    );
  },
};

export default noInternalExports;
