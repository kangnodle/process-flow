import { useCallback, useEffect, useRef } from 'react';

export function useDrawerFocus(open: boolean) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const focusTitle = useCallback(() => titleRef.current?.focus(), []);
  const bodyRef = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      const observer = new MutationObserver(() => {
        const active = node.ownerDocument.activeElement;
        if (openRef.current && (!active || active === node.ownerDocument.body)) focusTitle();
      });
      observer.observe(node, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    [focusTitle],
  );
  return { titleRef, bodyRef, focusTitle };
}

export function useFocusOnClose(open: boolean): (node: HTMLElement | null) => void {
  const ref = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) ref.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return useCallback((node: HTMLElement | null) => {
    ref.current = node;
  }, []);
}
