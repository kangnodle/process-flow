import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateCargoMetadata,
  validateFrontendManifests,
} from "./boundaries.mjs";

const rustPackage = (name, dependencies = [], targets = []) => ({
  id: name,
  name,
  dependencies,
  targets,
});
const dependency = (name, kind = null) => ({ name, kind });
const metadata = (...packages) => ({
  workspace_members: packages.map(({ id }) => id),
  packages,
});
const frontend = (name, dependencies = {}, extra = {}) => ({
  name: `@process-flow/${name}`,
  dependencies,
  ...extra,
});

test("cargo boundaries accept ports and inward dependency directions with test doubles", () => {
  assert.deepEqual(
    validateCargoMetadata(
      metadata(
        rustPackage("process-flow-domain", [dependency("serde_json", "dev")]),
        rustPackage("process-flow-application", [
          dependency("process-flow-domain"),
          dependency("async-trait"),
          dependency("thiserror"),
        ]),
        rustPackage("process-flow-runtime", [
          dependency("process-flow-application"),
          dependency("process-flow-testing", "dev"),
        ]),
        rustPackage("process-flow-testing", [
          dependency("process-flow-runtime"),
        ]),
      ),
    ),
    [],
  );
});

test("cargo boundaries reject domain dependencies, build scripts and outward application edges", () => {
  const failures = validateCargoMetadata(
    metadata(
      rustPackage(
        "process-flow-domain",
        [dependency("serde"), dependency("serde_json", "build")],
        [{ kind: ["custom-build"] }],
      ),
      rustPackage("process-flow-application", [
        dependency("process-flow-adapter-sqlite"),
        dependency("tokio"),
      ]),
      rustPackage("process-flow-adapter-sqlite"),
    ),
  );
  assert.equal(failures.length, 5);
  assert.ok(failures.some((failure) => failure.includes("custom-build")));
  assert.ok(failures.some((failure) => failure.includes("tokio")));
  assert.ok(
    failures.some((failure) => failure.includes("process-flow-adapter-sqlite")),
  );
});

test("cargo normal dependencies cannot cycle through adapters", () => {
  const failures = validateCargoMetadata(
    metadata(
      rustPackage("process-flow-adapter-sqlite", [
        dependency("process-flow-adapter-security"),
      ]),
      rustPackage("process-flow-adapter-security", [
        dependency("process-flow-adapter-sqlite"),
      ]),
    ),
  );
  assert.ok(failures.some((failure) => failure.includes("cycle")));
});

test("frontend boundaries validate manifests including peer and optional dependencies", () => {
  assert.deepEqual(
    validateFrontendManifests([
      frontend("domain"),
      frontend("application", { "@process-flow/domain": "0.1.0" }),
      frontend(
        "react",
        { "@process-flow/application": "0.1.0" },
        { peerDependencies: { react: "^19" } },
      ),
    ]),
    [],
  );
  const failures = validateFrontendManifests([
    frontend("domain", {}, { optionalDependencies: { react: "^19" } }),
    frontend(
      "application",
      {},
      { peerDependencies: { "@process-flow/ui": "0.1.0" } },
    ),
    frontend("ui", { "@process-flow/adapter-http": "0.1.0" }),
    frontend("adapter-http"),
  ]);
  assert.equal(failures.length, 3);
});

test("frontend boundaries reject package internals and undeclared workspace packages", () => {
  const failures = validateFrontendManifests([
    frontend("runtime", {
      "@process-flow/domain/internal": "0.1.0",
      "@process-flow/missing": "0.1.0",
    }),
  ]);
  assert.equal(failures.length, 2);
});
