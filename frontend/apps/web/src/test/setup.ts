import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

configure({ asyncUtilTimeout: 3000 });

afterEach(() => {
  cleanup();
});

if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

if (!('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

const initialBodyRect = document.body.getBoundingClientRect();
if (initialBodyRect.width === 0 && initialBodyRect.height === 0) {
  const viewportBox = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 768,
    right: 1024,
    width: 1024,
    height: 768,
  };
  const viewportRect: DOMRect = {
    ...viewportBox,
    toJSON: () => viewportBox,
  };
  document.body.getBoundingClientRect = () => viewportRect;
}

function resolveOffsetParent(element: HTMLElement): Element | null {
  if (
    !element.isConnected ||
    element === element.ownerDocument.body ||
    element === element.ownerDocument.documentElement
  ) {
    return null;
  }
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.style.display === 'none') {
      return null;
    }
  }
  return element.parentElement;
}

Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get(this: HTMLElement): Element | null {
    return resolveOffsetParent(this);
  },
});
