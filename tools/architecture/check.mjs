import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateCargoMetadata,
  validateFrontendManifests,
} from "./boundaries.mjs";

async function readManifests(root) {
  const workspace = JSON.parse(
    await readFile(resolve(root, "frontend/package.json"), "utf8"),
  );
  const manifests = [];
  for (const pattern of workspace.workspaces) {
    if (!pattern.endsWith("/*") || pattern.slice(0, -2).includes("*"))
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    const directory = resolve(root, "frontend", pattern.slice(0, -2));
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      manifests.push(
        JSON.parse(
          await readFile(
            resolve(directory, entry.name, "package.json"),
            "utf8",
          ),
        ),
      );
    }
  }
  return manifests;
}

async function main() {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--no-deps", "--locked", "--format-version", "1"],
      {
        cwd: resolve(root, "backend"),
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      },
    ),
  );
  const failures = [
    ...validateCargoMetadata(metadata),
    ...validateFrontendManifests(await readManifests(root)),
  ];
  if (failures.length) throw new Error(failures.join("\n"));
  process.stdout.write("Workspace dependency boundaries passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
