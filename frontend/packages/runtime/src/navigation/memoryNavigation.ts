import type { Navigation } from '@process-flow/application';

export function createMemoryNavigation(initial = '/'): Navigation {
  const stack = [initial];
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    current: () => stack[stack.length - 1] ?? '/',
    push(path) {
      stack.push(path);
      notify();
    },
    replace(path) {
      stack[stack.length - 1] = path;
      notify();
    },
    back() {
      if (stack.length <= 1) return false;
      stack.pop();
      notify();
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
