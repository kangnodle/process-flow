import { expect, it, vi } from 'vitest';
import { RequestError } from '@process-flow/application';
import { createProjectRepository } from './projectRepository';

const project = {
  id: 'p1',
  name: '결제',
  description: '',
  archived: false,
  version: 3,
  role: 'editor',
  permissions: ['project.view', 'workflow.start', 'workflow.execute', 'preferences.save'],
};
const respond =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });

it('목록을 불러온다(특별한 기본 프로젝트는 없다)', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(respond([{ ...project, id: 'p0' }, project]));
  const list = await createProjectRepository(request).list(true);
  expect(request).toHaveBeenCalledWith('/api/v1/projects?includeArchived=true', {});
  expect(list).toEqual([{ ...project, id: 'p0' }, project]);
});

it('수정은 기대 버전과 바꾼 항목만 PATCH로 보낸다', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(respond({ ...project, name: '새 이름', version: 4 }));
  const updated = await createProjectRepository(request).update('p1', 3, { name: '새 이름' });
  expect(updated.version).toBe(4);
  expect(request).toHaveBeenCalledWith('/api/v1/projects/p1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 3, name: '새 이름' }),
  });
});

it('서버 오류 코드를 화면이 고를 수 있는 종류로 바꾼다', async () => {
  const cases: Array<[number, string, string]> = [
    [409, 'versionConflict', 'versionConflict'],
    [409, 'conflict', 'conflict'],
    [404, 'notFound', 'notFound'],
    [400, 'badRequest', 'invalid'],
    [500, 'internal', 'unknown'],
  ];
  for (const [status, code, kind] of cases) {
    const request = vi.fn<typeof fetch>().mockImplementation(respond({ error: { code, message: 'x' } }, status));
    const result = createProjectRepository(request).get('p1');
    await expect(result).rejects.toBeInstanceOf(RequestError);
    await expect(result).rejects.toMatchObject({ kind });
  }
  const offline = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(createProjectRepository(offline).list(false)).rejects.toMatchObject({ kind: 'unknown' });
});

it('워크플로를 프로젝트 경로로 시작하고 요약을 검사한다', async () => {
  const workflow = {
    id: 'wf1',
    projectId: 'p1',
    processId: 'standard',
    name: '새 워크플로',
    version: 0,
    phase: { kind: 'working', stageIndex: 0, completed: 0 },
  };
  const request = vi.fn<typeof fetch>().mockImplementation(respond(workflow));
  const repository = createProjectRepository(request);
  await expect(repository.startWorkflow('p 1', '  ')).resolves.toEqual({
    id: 'wf1',
    projectId: 'p1',
    name: '새 워크플로',
    phase: workflow.phase,
  });
  expect(request).toHaveBeenCalledWith('/api/v1/projects/p%201/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  const broken = vi.fn<typeof fetch>().mockImplementation(respond([{ ...workflow, phase: { kind: 'nope' } }]));
  await expect(createProjectRepository(broken).workflows('p1')).rejects.toBeInstanceOf(RequestError);
});

it('내 역할과 권한을 읽고, 모르는 권한은 버리며, 역할이 없는 응답은 거절한다', async () => {
  const newer = { ...project, permissions: ['project.view', 'something.new'] };
  const request = vi.fn<typeof fetch>().mockImplementation(respond(newer));
  await expect(createProjectRepository(request).get('p1')).resolves.toMatchObject({
    role: 'editor',
    permissions: ['project.view'],
  });
  for (const bad of [
    { ...project, role: 'admin' },
    { ...project, permissions: undefined },
  ]) {
    const invalid = vi.fn<typeof fetch>().mockImplementation(respond(bad));
    await expect(createProjectRepository(invalid).get('p1')).rejects.toBeInstanceOf(RequestError);
  }
});
