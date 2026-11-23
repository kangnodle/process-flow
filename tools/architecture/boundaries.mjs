const frontendLayers = {
  domain: [],
  application: ["domain"],
  runtime: ["domain", "application"],
  "adapter-http": ["domain", "application"],
  "adapter-browser": ["domain", "application"],
  react: ["domain", "application", "runtime"],
  ui: ["domain", "application", "react"],
};

function cycles(edges) {
  const failures = [];
  const visited = new Set();
  const visiting = new Set();
  function visit(name, route) {
    if (visiting.has(name)) {
      failures.push(`Dependency cycle: ${[...route, name].join(" -> ")}`);
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of edges.get(name) ?? [])
      visit(dependency, [...route, name]);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of edges.keys()) visit(name, []);
  return failures;
}

function cargoLayer(name) {
  if (name === "process-flow-domain") return "domain";
  if (name === "process-flow-application") return "application";
  if (name === "process-flow-runtime") return "runtime";
  if (name === "process-flow-api") return "api";
  if (name === "process-flow-testing") return "testing";
  if (name === "process-flow-server") return "server";
  if (name.startsWith("process-flow-adapter-")) return "adapter";
  return undefined;
}

export function validateCargoMetadata(metadata) {
  const members = new Set(metadata.workspace_members);
  const packages = metadata.packages.filter(({ id }) => members.has(id));
  const names = new Set(packages.map(({ name }) => name));
  const edges = new Map();
  const failures = [];
  const allowedLayers = {
    domain: [],
    application: ["domain"],
    runtime: ["domain", "application"],
    adapter: ["domain", "application"],
    api: ["domain", "application", "runtime"],
    testing: ["domain", "application", "runtime"],
    server: ["domain", "application", "runtime", "adapter", "api"],
  };
  const pureDependencies = {
    domain: [],
    application: ["async-trait", "thiserror"],
  };
  for (const entry of packages) {
    const layer = cargoLayer(entry.name);
    if (!layer) failures.push(`Unknown Cargo workspace package: ${entry.name}`);
    if (
      ["domain", "application"].includes(layer) &&
      entry.targets.some(({ kind }) => kind.includes("custom-build"))
    ) {
      failures.push(
        `${entry.name}: custom-build is forbidden in the pure core`,
      );
    }
    const internal = [];
    for (const dependency of entry.dependencies) {
      if (dependency.kind === "dev") continue;
      const targetLayer = cargoLayer(dependency.name);
      const workspaceDependency =
        names.has(dependency.name) ||
        dependency.name.startsWith("process-flow-");
      if (workspaceDependency) {
        internal.push(dependency.name);
        if (
          !names.has(dependency.name) ||
          !allowedLayers[layer]?.includes(targetLayer)
        ) {
          failures.push(
            `${entry.name} -> ${dependency.name}: prohibited Cargo workspace dependency`,
          );
        }
      } else if (
        pureDependencies[layer] &&
        !pureDependencies[layer].includes(dependency.name)
      ) {
        failures.push(
          `${entry.name} -> ${dependency.name}: external dependency is forbidden in the pure core`,
        );
      }
      if (
        dependency.kind === "build" &&
        ["domain", "application"].includes(layer) &&
        pureDependencies[layer]?.includes(dependency.name)
      ) {
        failures.push(
          `${entry.name} -> ${dependency.name}: build dependency is forbidden in the pure core`,
        );
      }
    }
    edges.set(entry.name, internal);
  }
  return [...failures, ...cycles(edges)];
}

export function validateFrontendManifests(manifests) {
  const names = new Set(manifests.map(({ name }) => name));
  const failures = [];
  const edges = new Map();
  for (const manifest of manifests) {
    const layer = manifest.name.replace("@process-flow/", "");
    if (layer !== "web" && !Object.hasOwn(frontendLayers, layer))
      failures.push(`Unknown frontend workspace package: ${manifest.name}`);
    const internal = [];
    for (const kind of [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
      "devDependencies",
    ]) {
      for (const dependency of Object.keys(manifest[kind] ?? {})) {
        if (dependency.startsWith("@process-flow/")) {
          const target = dependency.replace("@process-flow/", "");
          if (
            !names.has(dependency) ||
            (layer !== "web" && !frontendLayers[layer]?.includes(target))
          ) {
            failures.push(
              `${manifest.name} -> ${dependency}: prohibited frontend workspace dependency`,
            );
          }
          if (kind !== "devDependencies") internal.push(dependency);
        } else if (
          kind !== "devDependencies" &&
          ["domain", "application"].includes(layer)
        ) {
          failures.push(
            `${manifest.name} -> ${dependency}: external dependency is forbidden in the pure core`,
          );
        }
      }
    }
    edges.set(manifest.name, internal);
  }
  return [...failures, ...cycles(edges)];
}
