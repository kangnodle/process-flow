import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentSurface,
  createHashNavigation,
  createMediaQueryColorScheme,
  createWorkflowIdentity,
} from './index';

afterEach(() => {
  document.documentElement.lang = '';
});

describe('createMediaQueryColorScheme', () => {
  it('미디어 쿼리 값을 모드로 바꾸고, 바뀌면 알린다', () => {
    const listeners = new Set<() => void>();
    const media = {
      matches: false,
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    } as unknown as MediaQueryList;
    const source = createMediaQueryColorScheme(() => media);
    const listener = vi.fn();

    expect(source.current()).toBe('light');
    const unsubscribe = source.subscribe(listener);
    (media as { matches: boolean }).matches = true;
    listeners.forEach((l) => l());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.current()).toBe('dark');

    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});

describe('createDocumentSurface', () => {
  it('문서 언어와 제목을 바꾼다', () => {
    const surface = createDocumentSurface(document);
    surface.setLanguage('en');
    surface.setTitle('Process');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Process');
  });
});

describe('createWorkflowIdentity', () => {
  it('저장한 워크플로를 주소와 localStorage에 남기고, clear로 둘 다 잊는다', () => {
    window.history.replaceState(null, '', '/?view=x');
    localStorage.clear();
    const identity = createWorkflowIdentity();
    identity.save('wf1');
    expect(new URL(window.location.href).searchParams.get('workflow')).toBe('wf1');
    expect(identity.load()).toBe('wf1');

    identity.clear();
    expect(new URL(window.location.href).searchParams.get('workflow')).toBeNull();
    expect(new URL(window.location.href).searchParams.get('view')).toBe('x');
    expect(localStorage.getItem('process-flow:workflow')).toBeNull();
    expect(identity.load()).toBeUndefined();
    window.history.replaceState(null, '', '/');
  });
});

describe('createHashNavigation', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('경로를 해시에 두고, 워크플로 ID 검색어와 앱이 쌓은 기록 깊이를 지킨다', async () => {
    window.history.replaceState(null, '', '/?workflow=wf-1');
    const navigation = createHashNavigation(window);
    const changed = vi.fn();
    const unsubscribe = navigation.subscribe(changed);
    expect(navigation.current()).toBe('/');
    expect(navigation.back()).toBe(false);

    navigation.push('/projects/p1');
    expect(window.location.search).toBe('?workflow=wf-1');
    expect(window.location.hash).toBe('#/projects/p1');
    expect(navigation.current()).toBe('/projects/p1');
    expect(changed).toHaveBeenCalledTimes(1);

    createWorkflowIdentity().save('wf-2');
    expect(window.location.hash).toBe('#/projects/p1');

    const popped = new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    expect(navigation.back()).toBe(true);
    await popped;
    expect(navigation.current()).toBe('/');
    expect(changed.mock.calls.length).toBeGreaterThan(1);

    navigation.replace('/users');
    expect(navigation.current()).toBe('/users');
    navigation.replace('/');
    expect(window.location.hash).toBe('');
    unsubscribe();
  });
});
