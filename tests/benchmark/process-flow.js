import { check, sleep } from 'k6';
import exec from 'k6/execution';
import http from 'k6/http';
import { benchmarkCredentials } from './account.js';
import { benchmarkRunDescription } from './seed-project.js';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const api = '/api/v1';
const cookieName = 'pf_session';
const processPath = api + '/processes/standard';
const taskForms = JSON.parse(open('../../frontend/packages/domain/src/process/task-forms.json'));
const credentials = benchmarkCredentials();
const profile = __ENV.PROFILE || 'smoke';

if (!['smoke', 'load'].includes(profile)) {
  throw new Error('PROFILE must be smoke or load');
}

function positiveInt(name, fallback) {
  const value = Number(__ENV[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
  return value;
}

const totalUsers = profile === 'load' && __ENV.TOTAL_VUS !== undefined ? positiveInt('TOTAL_VUS') : null;
const sessionUsers = totalUsers >= 3 ? Math.max(1, Math.floor(totalUsers / 11)) : 0;
const progressUsers = totalUsers >= 2 ? Math.max(1, Math.floor((totalUsers * 2) / 11)) : 0;
const workloads = {
  browse: {
    vus: totalUsers === null ? positiveInt('BROWSE_VUS', 8) : totalUsers - progressUsers - sessionUsers,
    p95: positiveInt('BROWSE_P95_MS', 750),
  },
  progress: {
    vus: totalUsers === null ? positiveInt('PROGRESS_VUS', 2) : progressUsers,
    p95: positiveInt('PROGRESS_P95_MS', 1000),
  },
  session: {
    vus: totalUsers === null ? positiveInt('AUTH_VUS', 1) : sessionUsers,
    p95: positiveInt('AUTH_P95_MS', 1500),
  },
};

const scenarios = {};
const thresholds = {};
for (const [name, { vus, p95 }] of Object.entries(workloads)) {
  if (vus === 0) continue;
  scenarios[name] =
    profile === 'smoke'
      ? { exec: name, executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '60s' }
      : {
          exec: name,
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: __ENV.RAMP_UP || '15s', target: vus },
            { duration: __ENV.HOLD || '45s', target: vus },
            { duration: __ENV.RAMP_DOWN || '15s', target: 0 },
          ],
          gracefulRampDown: '30s',
        };
  const scope = '{scenario:' + name + '}';
  thresholds['http_req_failed' + scope] = ['rate<0.01'];
  thresholds['http_req_duration' + scope] = ['p(95)<' + p95];
  thresholds['checks' + scope] = ['rate==1'];
  thresholds['iterations' + scope] = ['count>0'];
}

export const options = {
  scenarios,
  thresholds,
  setupTimeout: '2m',
  teardownTimeout: '2m',
  systemTags: ['status', 'method', 'name', 'check', 'error', 'error_code', 'scenario', 'expected_response'],
};

const statusCallbacks = {
  200: http.expectedStatuses(200),
  201: http.expectedStatuses(201),
  204: http.expectedStatuses(204),
};

function readJson(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function request(name, method, path, { status = 200, body, token, validate, phase = 'load' } = {}) {
  const response = http.request(method, baseUrl + path, body === undefined ? null : JSON.stringify(body), {
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    cookies: token ? { [cookieName]: { value: token, replace: true } } : {},
    tags: { name, phase },
    redirects: 0,
    timeout: '10s',
    responseCallback: statusCallbacks[status],
  });

  const data = status === 204 ? null : readJson(response);
  if (
    !check(
      response,
      {
        [name]: (r) => r.status === status && (validate ? !!validate(data) : status === 204 || data !== null),
      },
      { phase },
    )
  ) {
    const code = data?.error?.code;
    const message =
      name +
      ': expected HTTP ' +
      status +
      ' and valid response; got ' +
      response.status +
      (code ? ' (' + code + ')' : '');
    if (phase !== 'load') throw new Error(message);
    if (profile === 'smoke' || exec.vu.iterationInScenario === 0) console.warn(message);
    return null;
  }
  return { data };
}

function projectPath(id) {
  return api + '/projects/' + encodeURIComponent(id);
}

function workflowPath(id) {
  return api + '/workflows/' + encodeURIComponent(id);
}

function login(phase) {
  return request('auth.login', 'POST', api + '/auth/login', {
    body: credentials,
    phase,
    validate: (user) =>
      typeof user?.id === 'string' && user.email?.toLowerCase() === credentials.email.trim().toLowerCase(),
  });
}

function logout(phase, token) {
  return request('auth.logout', 'POST', api + '/auth/logout', { status: 204, phase, token });
}

function startWorkflow(projectId, name, token, phase) {
  return request('workflows.create', 'POST', projectPath(projectId) + '/workflows', {
    status: 201,
    body: { name },
    token,
    phase,
    validate: (workflow) =>
      workflow?.projectId === projectId &&
      typeof workflow.id === 'string' &&
      Number.isInteger(workflow.version) &&
      workflow.phase?.kind === 'working',
  })?.data;
}

function command(workflow, action, eventType, validate, token, phase) {
  return request('workflow.' + action.type, 'POST', workflowPath(workflow.id) + '/commands', {
    body: { expectedVersion: workflow.version, command: action },
    token,
    phase,
    validate: (result) =>
      result?.changed === true &&
      result.workflow?.id === workflow.id &&
      result.workflow.version === workflow.version + 1 &&
      result.events?.some(
        (event) =>
          event.type === eventType &&
          (action.taskId === undefined || event.taskId === action.taskId) &&
          (action.stageIndex === undefined || event.stageIndex === action.stageIndex),
      ) &&
      validate(result.workflow),
  })?.data.workflow;
}

function searchPath(fixture) {
  return (
    api +
    '/search/records?q=' +
    encodeURIComponent(fixture.query) +
    '&workflowId=' +
    encodeURIComponent(fixture.workflowId) +
    '&limit=10'
  );
}

function hasSeedHit(data, fixture) {
  return (
    Array.isArray(data?.hits) &&
    data.hits.some(
      (hit) =>
        hit.workflowId === fixture.workflowId && hit.taskId === fixture.taskIds[0] && hit.text?.includes(fixture.query),
    )
  );
}

function cleanup(fixture) {
  const { token, projectId } = fixture;
  try {
    if (projectId) {
      const path = projectPath(projectId);
      const { data: archived } = request('projects.archive', 'DELETE', path, {
        token,
        phase: 'cleanup',
        validate: (project) => project?.id === projectId && project.archived && Number.isInteger(project.version),
      });
      request('projects.deleteFixture', 'DELETE', path + '/permanent', {
        token,
        phase: 'cleanup',
        status: 204,
        body: { expectedVersion: archived.version },
      });
    }
  } finally {
    logout('cleanup', token);
  }
}

export function setup() {
  const description = benchmarkRunDescription();
  if (!credentials.email?.trim() || !credentials.password) {
    throw new Error('Set BENCH_EMAIL and BENCH_PASSWORD for an existing benchmark account');
  }
  if (__ENV.BENCH_ALLOW_WRITES !== '1') {
    throw new Error('Set BENCH_ALLOW_WRITES=1 to create and remove a benchmark project on the target server');
  }

  const phase = 'setup';
  request('health', 'GET', '/health', { phase, validate: (data) => data?.status === 'ok' });
  login(phase);
  const token = http.cookieJar().cookiesForURL(baseUrl + api + '/auth/status')[cookieName]?.[0];
  if (!token) throw new Error('Login returned no usable pf_session cookie; check BASE_URL and COOKIE_SECURE');

  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  const fixture = { token, query: 'process flow benchmark ' + runId, projectId: null };
  try {
    const { data: process } = request('process.standard', 'GET', processPath, {
      token,
      phase,
      validate: (data) =>
        data?.id === 'standard' && data.stages?.[0]?.tasks?.length > 0 && data.stages[1]?.tasks?.length > 0,
    });
    fixture.taskIds = process.stages[0].tasks.map(({ id }) => id);
    fixture.prerequisitesTask = process.stages[1].tasks[0].id;
    const { data: project } = request('projects.createFixture', 'POST', api + '/projects', {
      status: 201,
      body: { name: 'k6-benchmark-' + runId, description },
      token,
      phase,
      validate: (data) => typeof data?.id === 'string',
    });
    fixture.projectId = project.id;
    console.log('Benchmark fixture: ' + project.name + ' (' + project.id + ')');

    const workflow = startWorkflow(project.id, 'Search fixture', token, phase);
    fixture.workflowId = workflow.id;
    const taskId = fixture.taskIds[0];
    command(
      workflow,
      { type: 'updateRecord', taskId, patch: { note: fixture.query } },
      'recordUpdated',
      (data) => data.records?.[taskId]?.note === fixture.query,
      token,
      phase,
    );

    const deadline = Date.now() + 30_000;
    do {
      const { data } = request('records.searchSeed', 'GET', searchPath(fixture), {
        token,
        phase,
        validate: (result) => Array.isArray(result?.hits),
      });
      if (hasSeedHit(data, fixture)) return fixture;
      sleep(0.5);
    } while (Date.now() < deadline);
    throw new Error('The benchmark fixture did not appear in the search index within 30s');
  } catch (error) {
    try {
      cleanup(fixture);
    } catch (cleanupError) {
      console.error('Fixture cleanup failed: ' + cleanupError.message);
    }
    throw error;
  }
}

function think() {
  if (profile === 'load') sleep(0.5 + Math.random());
}

export function browse(fixture) {
  const { projectId, workflowId, taskIds, prerequisitesTask, token } = fixture;
  const routes = [
    ['projects.list', api + '/projects', (data) => Array.isArray(data) && data.some(({ id }) => id === projectId)],
    ['projects.detail', projectPath(projectId), (data) => data?.id === projectId],
    [
      'workflows.list',
      projectPath(projectId) + '/workflows',
      (data) => Array.isArray(data) && data.some(({ id }) => id === workflowId),
    ],
    ['workflows.detail', workflowPath(workflowId), (data) => data?.id === workflowId && data.projectId === projectId],
    ['process.standard', processPath, (data) => data?.id === 'standard' && Array.isArray(data.stages)],
    [
      'process.prerequisites',
      processPath + '/tasks/' + encodeURIComponent(prerequisitesTask) + '/prerequisites',
      (data) =>
        data?.taskId === prerequisitesTask &&
        Array.isArray(data.prerequisites) &&
        data.prerequisites.length === taskIds.length &&
        taskIds.every((id) => data.prerequisites.includes(id)),
    ],
    ['work.mine', api + '/me/work', (data) => Array.isArray(data?.items)],
    ['records.search', searchPath(fixture), (data) => hasSeedHit(data, fixture)],
  ];
  for (const [name, path, validate] of routes) request(name, 'GET', path, { token, validate });
  think();
}

export function progress({ projectId, taskIds, token }) {
  const name = 'Progress VU ' + exec.vu.idInTest + ' iteration ' + exec.scenario.iterationInTest;
  let workflow = startWorkflow(projectId, name, token);
  if (!workflow) return;
  for (const taskId of taskIds) {
    const note = 'Benchmark planning record for ' + taskId;
    const answers = Object.fromEntries((taskForms[taskId] || []).map(({ id }) => [id, note]));
    workflow = command(
      workflow,
      {
        type: 'updateRecord',
        taskId,
        patch: { note, document: { version: 1, answers, reviewStatus: 'passed' } },
      },
      'recordUpdated',
      (data) => data.records?.[taskId]?.note === note,
      token,
    );
    if (!workflow) return;
    workflow = command(
      workflow,
      { type: 'completeTask', taskId },
      'taskCompleted',
      (data) => data.done?.includes(taskId),
      token,
    );
    if (!workflow) return;
  }
  command(
    workflow,
    { type: 'approveStage', stageIndex: 0 },
    'stageApproved',
    (data) => data.phase?.kind === 'working' && data.phase.stageIndex === 1,
    token,
  );
  think();
}

export function session() {
  const grant = login('load');
  if (grant) {
    try {
      request('auth.status', 'GET', api + '/auth/status', {
        validate: (data) => data?.user?.id === grant.data.id && data.setupRequired === false,
      });
    } finally {
      logout('load');
    }
  }
  think();
}

export function teardown(fixture) {
  cleanup(fixture);
}
