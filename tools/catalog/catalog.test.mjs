import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { generateCatalog } from "./catalog.mjs";

const field = {
  id: "problem",
  label: { ko: "문제", en: "Problem" },
  hint: { ko: "설명", en: "Describe" },
};
const catalog = { goals: [field] };

test("generation preserves catalog order and text deterministically", () => {
  const result = generateCatalog({
    z: [field],
    goals: [{ ...field, allowNotApplicable: true }],
  });
  assert.deepEqual(Object.keys(JSON.parse(result.frontend)), ["z", "goals"]);
  assert.deepEqual(JSON.parse(result.frontend), {
    goals: [{ ...field, allowNotApplicable: true }],
    z: [field],
  });
  assert.equal(
    result.rust,
    'use super::TaskField;\n\npub(super) const TASK_FORMS: &[(&str, &[TaskField])] = &[\n    ("z", &[TaskField { id: "problem", allow_not_applicable: false }]),\n    ("goals", &[TaskField { id: "problem", allow_not_applicable: true }]),\n];\n',
  );
  assert.deepEqual(
    generateCatalog({
      z: [field],
      goals: [{ ...field, allowNotApplicable: true }],
    }),
    result,
  );
});

test("invalid catalogs cannot produce either generated artifact", () => {
  for (const invalid of [
    null,
    [],
    {},
    { goals: [] },
    { goals: [field, field] },
    { goals: [{ ...field, id: "" }] },
    { goals: [{ ...field, label: { en: "Problem" } }] },
    { goals: [{ ...field, allowNotApplicable: "yes" }] },
    { goals: [{ ...field, unknown: true }] },
  ]) {
    assert.throws(() => generateCatalog(invalid), /catalog/i);
  }
});

test("rust literal escaping preserves quotes, slashes and control characters", () => {
  const result = generateCatalog({ 'a"\\\n': [{ ...field, id: "b\t\u0000" }] });
  assert.ok(result.rust.includes('("a\\"\\\\\\n",'));
  assert.ok(result.rust.includes('id: "b\\t\\u{0}"'));
});

test("check mode detects drift and missing output without rewriting either artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "process-flow-catalog-"));
  const cli = new URL("./generate.mjs", import.meta.url).pathname;
  const output = join(
    root,
    "frontend/packages/domain/src/process/task-forms.json",
  );
  try {
    await mkdir(join(root, "contracts"));
    await writeFile(
      join(root, "contracts/task-forms.json"),
      JSON.stringify(catalog),
    );
    let result = spawnSync(process.execPath, [cli, "--root", root], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    result = spawnSync(process.execPath, [cli, "--root", root, "--check"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    await writeFile(output, "stale\n");
    result = spawnSync(process.execPath, [cli, "--root", root, "--check"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /task-forms.json/);
    assert.equal(await readFile(output, "utf8"), "stale\n");
    await rm(output);
    result = spawnSync(process.execPath, [cli, "--root", root, "--check"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    await assert.rejects(readFile(output), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
