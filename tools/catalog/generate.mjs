import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCatalog } from "./catalog.mjs";

async function main() {
  const argumentsList = process.argv.slice(2);
  let root = fileURLToPath(new URL("../..", import.meta.url));
  let check = false;
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--check") check = true;
    else if (argument === "--root" && argumentsList[index + 1])
      root = resolve(argumentsList[++index]);
    else throw new Error(`Unknown catalog argument: ${argument}`);
  }
  const catalog = JSON.parse(
    await readFile(resolve(root, "contracts/task-forms.json"), "utf8"),
  );
  const generated = generateCatalog(catalog);
  const outputs = [
    [
      "frontend/packages/domain/src/process/task-forms.json",
      generated.frontend,
    ],
    ["backend/crates/core/domain/src/workflow/task_forms.rs", generated.rust],
  ];
  const drift = [];
  for (const [relativePath, contents] of outputs) {
    const destination = resolve(root, relativePath);
    if (check) {
      let actual;
      try {
        actual = await readFile(destination, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (actual !== contents) drift.push(relativePath);
    } else {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }
  }
  if (drift.length)
    throw new Error(`Catalog outputs need generation: ${drift.join(", ")}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
