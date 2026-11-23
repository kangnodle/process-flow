import http from 'k6/http';
import { benchmarkCredentials } from './account.js';
import { benchmarkRunDescription, seedProjectDescription } from './seed-project.js';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const api = '/api/v1';
const taskForms = JSON.parse(open('../../frontend/packages/domain/src/process/task-forms.json'));

export const options = {
  vus: 1,
  iterations: 1,
  setupTimeout: __ENV.SEED_TIMEOUT || '30m',
};

function count(name, fallback, minimum = 0) {
  const raw = __ENV[name] ?? String(fallback);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

function request(method, path, expectedStatus, body) {
  const response = http.request(method, baseUrl + api + path, body === undefined ? null : JSON.stringify(body), {
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    redirects: 0,
    timeout: '10s',
  });
  if (response.status !== expectedStatus) {
    const command = body?.command;
    const detail = command ? ` (${command.type} ${command.taskId ?? command.stageIndex})` : '';
    throw new Error(`${method} ${path}${detail}: expected HTTP ${expectedStatus}, got ${response.status}`);
  }
  return expectedStatus === 204 ? null : response.json();
}

function share(total, groups, index) {
  return Math.floor(total / groups) + (index < total % groups ? 1 : 0);
}

function execute(workflow, command) {
  const result = request('POST', `/workflows/${encodeURIComponent(workflow.id)}/commands`, 200, {
    expectedVersion: workflow.version,
    command,
  });
  if (!result.changed || result.workflow?.id !== workflow.id || result.workflow.version !== workflow.version + 1) {
    throw new Error(`Workflow ${workflow.id} did not apply ${command.type}`);
  }
  return result.workflow;
}

function seedRecords(workflow, stages, remaining, totals) {
  for (const [stageIndex, stage] of stages.entries()) {
    if (remaining === 0) return;
    const needsNextStage = remaining > stage.tasks.length;
    for (const { id: taskId } of stage.tasks.slice(0, remaining)) {
      const note = `Benchmark record for ${taskId} in ${workflow.name}`;
      const answers = Object.fromEntries(
        (taskForms[taskId] || []).map(({ id }) => [id, `Benchmark example for ${taskId}: ${id}`]),
      );
      workflow = execute(workflow, {
        type: 'updateRecord',
        taskId,
        patch: { note, document: { version: 1, answers, reviewStatus: 'passed' } },
      });
      totals.records += 1;
      if (needsNextStage) {
        workflow = execute(workflow, { type: 'completeTask', taskId });
      }
    }
    if (!needsNextStage) return;
    workflow = execute(workflow, { type: 'approveStage', stageIndex });
    remaining -= stage.tasks.length;
  }
}

export function setup() {
  const description = benchmarkRunDescription() ?? seedProjectDescription;
  const projects = count('SEED_PROJECTS', 3, 1);
  const workflows = count('SEED_WORKFLOWS', 12);
  const records = count('SEED_RECORDS', 60);
  if (workflows === 0 && records > 0) {
    throw new Error('SEED_RECORDS must be 0 when SEED_WORKFLOWS is 0');
  }

  const { email, password } = benchmarkCredentials();
  if (!email?.trim() || !password) {
    throw new Error('Set BENCH_EMAIL and BENCH_PASSWORD for an existing benchmark account');
  }

  request('POST', '/auth/login', 200, { email, password });
  if (!http.cookieJar().cookiesForURL(baseUrl + api + '/projects').pf_session?.length) {
    throw new Error('Login returned no usable pf_session cookie; check BASE_URL and COOKIE_SECURE');
  }

  const runId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const prefix = 'k6-seed-' + runId;
  const totals = { projects: 0, workflows: 0, records: 0 };
  try {
    const { stages } = request('GET', '/processes/standard', 200);
    const recordsPerWorkflow = stages.reduce((sum, stage) => sum + stage.tasks.length, 0);
    if (Math.ceil(records / (workflows || 1)) > recordsPerWorkflow) {
      throw new Error(`SEED_RECORDS exceeds capacity: at most ${recordsPerWorkflow} records per workflow`);
    }

    for (let projectIndex = 0; projectIndex < projects; projectIndex += 1) {
      const project = request('POST', '/projects', 201, {
        name: `${prefix}-${projectIndex + 1}`,
        description,
      });
      totals.projects += 1;
      console.log(`Created ${project.name} (${project.id})`);

      const projectWorkflows = share(workflows, projects, projectIndex);
      for (let i = 0; i < projectWorkflows; i += 1) {
        const recordCount = share(records, workflows, totals.workflows);
        const workflow = request('POST', `/projects/${encodeURIComponent(project.id)}/workflows`, 201, {
          name: `${prefix}-workflow-${totals.workflows + 1}`,
          processId: 'standard',
        });
        totals.workflows += 1;
        seedRecords(workflow, stages, recordCount, totals);
      }
    }
  } catch (error) {
    console.error(`Seed ${prefix} stopped after confirming ${JSON.stringify(totals)}. Created data remains.`);
    throw error;
  } finally {
    try {
      request('POST', '/auth/logout', 204);
    } catch (error) {
      console.warn(`Could not close the seed session: ${error.message}`);
    }
  }
  console.log(
    `Seed ${prefix} completed: ${totals.projects} projects, ${totals.workflows} workflows, ${totals.records} records`,
  );
}

export default function () {}
