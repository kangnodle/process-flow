import type { Navigation } from '@process-flow/application';

const DEPTH_KEY = 'processFlowDepth';

function depthOf(state: unknown): number {
  if (state && typeof state === 'object' && DEPTH_KEY in state) {
    const depth = (state as Record<string, unknown>)[DEPTH_KEY];
    return typeof depth === 'number' ? depth : 0;
  }
  return 0;
}

export function createHashNavigation(win: Window): Navigation {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const urlFor = (path: string) => {
    const url = new URL(win.location.href);
    url.hash = path === '/' ? '' : path;
    return url;
  };
  return {
    current: () => win.location.hash.replace(/^#/, '') || '/',
    push(path) {
      win.history.pushState({ [DEPTH_KEY]: depthOf(win.history.state) + 1 }, '', urlFor(path));
      notify();
    },
    replace(path) {
      win.history.replaceState(win.history.state, '', urlFor(path));
      notify();
    },
    back() {
      if (depthOf(win.history.state) <= 0) return false;
      win.history.back();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      win.addEventListener('popstate', listener);
      win.addEventListener('hashchange', listener);
      return () => {
        listeners.delete(listener);
        win.removeEventListener('popstate', listener);
        win.removeEventListener('hashchange', listener);
      };
    },
  };
}
