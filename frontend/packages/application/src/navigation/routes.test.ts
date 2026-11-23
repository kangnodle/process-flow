import { describe, expect, it } from 'vitest';
import { HOME, parentRoute, parseRoute, routePath, type Route } from './routes';

describe('화면 경로', () => {
  const routes: Route[] = [
    HOME,
    { page: 'projects' },
    { page: 'project', projectId: 'p 1/x' },
    { page: 'users' },
    { page: 'assignments' },
    { page: 'myWork' },
  ];

  it('경로 문자열로 바꿨다가 되돌리면 같은 화면이다', () => {
    for (const route of routes) expect(parseRoute(routePath(route))).toEqual(route);
  });

  it('모르는 경로는 홈으로 본다', () => {
    expect(parseRoute('')).toEqual(HOME);
    expect(parseRoute('/nope')).toEqual(HOME);
    expect(parseRoute('/projects/a/b')).toEqual(HOME);
  });

  it('한 단계 위는 프로젝트 상세면 목록, 나머지는 홈이다', () => {
    expect(parentRoute({ page: 'project', projectId: 'p1' })).toEqual({ page: 'projects' });
    expect(parentRoute({ page: 'users' })).toEqual(HOME);
  });
});
