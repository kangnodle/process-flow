import http from 'k6/http';
import { administratorCredentials, testAccount } from './account.js';
import { benchmarkRunDescription, seedProjectDescription } from './seed-project.js';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const api = '/api/v1';
const seedProjectName = /^k6-seed-[a-z0-9]+-[a-z0-9]{0,8}-[1-9]\d*$/;

export const options = {
  vus: 1,
  iterations: 1,
  setupTimeout: __ENV.CLEANUP_TIMEOUT || '30m',
};

function request(method, path, expectedStatus, body) {
  const response = http.request(method, baseUrl + api + path, body === undefined ? null : JSON.stringify(body), {
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    redirects: 0,
    timeout: '30s',
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${method} ${path}: expected HTTP ${expectedStatus}, got ${response.status}`);
  }
  return expectedStatus === 204 ? null : response.json();
}

function isSeedProject(project, includeLegacy) {
  return (
    project?.role === 'owner' &&
    seedProjectName.test(project.name) &&
    (project.description === seedProjectDescription || (includeLegacy && project.description === ''))
  );
}

function listTargets(ids, matchesProject) {
  const projects = request('GET', '/projects?includeArchived=true', 200);
  if (!ids) return projects.filter(matchesProject);

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const targets = [];
  for (const id of ids) {
    const project = projectsById.get(id);
    if (!project) {
      console.warn(`Project ${id} is absent from the visible project list`);
      continue;
    }
    if (!matchesProject(project)) {
      throw new Error(`Project ${id} does not match seed project criteria`);
    }
    targets.push(project);
  }
  return targets;
}

function deleteProject(project, matchesProject) {
  if (!Number.isSafeInteger(project.version)) throw new Error('Invalid project version');

  const path = `/projects/${encodeURIComponent(project.id)}`;
  const archived = project.archived
    ? project
    : request('PATCH', path, 200, { archived: true, expectedVersion: project.version });

  if (
    archived?.id !== project.id ||
    archived.archived !== true ||
    !matchesProject(archived) ||
    !Number.isSafeInteger(archived.version)
  ) {
    throw new Error('Archived project failed the seed project checks');
  }

  request('DELETE', path + '/permanent', 204, { expectedVersion: archived.version });
}

export function setup() {
  const runDescription = benchmarkRunDescription();
  const rawIds = runDescription ? undefined : __ENV.CLEANUP_PROJECT_IDS;
  const ids = rawIds === undefined ? null : new Set(rawIds.split(',').map((id) => id.trim()));
  if (ids?.has('')) throw new Error('CLEANUP_PROJECT_IDS must contain comma-separated project IDs');
  const apply = __ENV.CLEANUP_APPLY === '1';
  const matchesProject = runDescription
    ? (project) => project?.role === 'owner' && project.description === runDescription
    : (project) => isSeedProject(project, ids !== null);
  const scope = runDescription ? `benchmark run ${__ENV.BENCH_RUN_ID}` : 'seed data';

  const { email, password } = administratorCredentials();
  const account = testAccount();
  if (!email?.trim() || !password) {
    throw new Error('Set BENCH_EMAIL and BENCH_PASSWORD for an existing benchmark account');
  }

  request('POST', '/auth/login', 200, { email, password });
  try {
    const targets = listTargets(ids, matchesProject);
    console.log(`${targets.length} project(s) for ${scope} on ${baseUrl}`);
    for (const project of targets) console.log(`${project.name} (${project.id})`);

    if (!apply) {
      console.log('Preview only. Pass -e CLEANUP_APPLY=1 to permanently delete the listed projects.');
      return;
    }

    let failed = 0;
    for (const project of targets) {
      try {
        deleteProject(project, matchesProject);
        console.log(`Deleted ${project.name} (${project.id})`);
      } catch (error) {
        failed += 1;
        console.error(`Could not delete ${project.name} (${project.id}): ${error.message}`);
      }
    }
    console.log(`Deleted ${targets.length - failed} of ${targets.length} project(s) for ${scope}`);
    if (account) {
      try {
        const users = request('GET', '/users?includeInactive=true', 200);
        const user = users.find((user) => user.email === account.email);
        if (user) {
          if (user.name !== account.name || user.isAdmin) throw new Error('Test account identity does not match');
          if (user.active) {
            const inactive = request('PATCH', `/users/${encodeURIComponent(user.id)}`, 200, {
              active: false,
              expectedVersion: user.version,
            });
            if (inactive.active !== false) throw new Error('Test account remains active');
          }
          request('PUT', `/users/${encodeURIComponent(user.id)}/password`, 204, { password: account.password });
          console.log(`Deactivated test account ${user.email} (${user.id})`);
        }
      } catch (error) {
        failed += 1;
        console.error(`Could not clean up the test account: ${error.message}`);
      }
    }
    if (failed > 0) throw new Error(`Cleanup failed for ${failed} project(s) for ${scope}`);
  } finally {
    try {
      request('POST', '/auth/logout', 204);
    } catch (error) {
      console.warn(`Could not close the cleanup session: ${error.message}`);
    }
  }
}

export default function () {}
