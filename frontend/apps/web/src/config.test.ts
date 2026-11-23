import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVICE_NAME, parseConfig } from './config';

describe('parseConfig', () => {
  it('빈 서비스 이름은 기본 이름으로, 빈 프로젝트 이름은 없는 것으로 보고, VITE_DEMO는 "true"일 때만 켠다', () => {
    expect(parseConfig({})).toEqual({ serviceName: DEFAULT_SERVICE_NAME, projectName: undefined, demo: false });
    expect(parseConfig({ VITE_SERVICE_NAME: ' ', VITE_PROJECT_NAME: '사내 포털', VITE_DEMO: 'true' })).toEqual({
      serviceName: 'Process Flow',
      projectName: '사내 포털',
      demo: true,
    });
    expect(parseConfig({ VITE_DEMO: '1' }).demo).toBe(false);
    expect(parseConfig({ VITE_SERVICE_NAME: '사내 공정' }).serviceName).toBe('사내 공정');
  });
});
