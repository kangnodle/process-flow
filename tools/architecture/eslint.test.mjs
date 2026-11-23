import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const frontend = fileURLToPath(new URL("../../frontend/", import.meta.url));
const require = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { ESLint } = require("eslint");
const eslint = new ESLint({ cwd: frontend });

async function messages(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages;
}

test("domain rejects an arbitrary external dependency while local modules remain valid", async () => {
  const invalid = await messages(
    "import { value } from 'an-unapproved-library'; export { value };",
    "packages/domain/src/architecture-fixture.ts",
  );
  assert.ok(invalid.some(({ ruleId }) => ruleId === "no-restricted-imports"));
  const valid = await messages(
    "import { value } from './value'; export { value };",
    "packages/domain/src/architecture-fixture.ts",
  );
  assert.deepEqual(valid, []);
});

test("pure core rejects browser, timing and random side effects", async () => {
  for (const layer of ["domain", "application"]) {
    const invalid = await messages(
      "export function read() { return [window.location.href, Date.now(), Math.random()]; }",
      `packages/${layer}/src/architecture-fixture.ts`,
    );
    assert.ok(invalid.some(({ ruleId }) => ruleId === "no-restricted-globals"));
    assert.equal(
      invalid.filter(({ ruleId }) => ruleId === "no-restricted-properties")
        .length,
      2,
    );
  }
});

test("UI rejects repository imports including aliases but permits use case contracts", async () => {
  const invalid = await messages(
    "import type { UserRepository as Users } from '@process-flow/application'; export type Input = Users;",
    "packages/ui/src/architecture-fixture.ts",
  );
  assert.ok(invalid.some(({ ruleId }) => ruleId === "workspace/ui-use-cases"));
  const valid = await messages(
    "import type { UserUseCases } from '@process-flow/application'; export type Input = UserUseCases;",
    "packages/ui/src/architecture-fixture.ts",
  );
  assert.deepEqual(valid, []);
});

test("UI rejects direct repository method calls through objects and context properties", async () => {
  const direct = await messages(
    "export function save(repository: { create(): void }) { repository.create(); }",
    "packages/ui/src/architecture-fixture.ts",
  );
  assert.ok(direct.some(({ ruleId }) => ruleId === "workspace/ui-use-cases"));
  const nested = await messages(
    "export function save(context: { repository: { create(): void } }) { context.repository.create(); }",
    "packages/ui/src/architecture-fixture.ts",
  );
  assert.ok(nested.some(({ ruleId }) => ruleId === "workspace/ui-use-cases"));
});

test("cross-package relative imports fail while public package imports remain valid", async () => {
  const invalid = await messages(
    "import { value } from '../../domain/src/value'; export { value };",
    "packages/application/src/architecture-fixture.ts",
  );
  assert.ok(
    invalid.some(({ ruleId }) => ruleId === "workspace/public-entrypoint"),
  );
  const valid = await messages(
    "import { value } from '@process-flow/domain'; export { value };",
    "packages/application/src/architecture-fixture.ts",
  );
  assert.deepEqual(valid, []);
});

test("application accepts only the domain package and local modules", async () => {
  const invalid = await messages(
    "import { value } from 'an-unapproved-library'; export { value };",
    "packages/application/src/architecture-fixture.ts",
  );
  assert.ok(invalid.some(({ ruleId }) => ruleId === "no-restricted-imports"));
  const valid = await messages(
    "import { value } from '@process-flow/domain'; export { value };",
    "packages/application/src/architecture-fixture.ts",
  );
  assert.deepEqual(valid, []);
});
