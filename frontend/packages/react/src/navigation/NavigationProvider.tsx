import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { type Navigation, parentRoute, parseRoute, routePath, sameRoute } from '@process-flow/application';
import { createMemoryNavigation } from '@process-flow/runtime';
import { NavigationContext, type NavigationContextValue } from './navigationContext';

export function NavigationProvider({
  navigation: given,
  children,
}: {
  readonly navigation?: Navigation;
  readonly children: ReactNode;
}) {
  const [fallback] = useState(() => createMemoryNavigation());
  const navigation = given ?? fallback;
  const path = useSyncExternalStore(navigation.subscribe, navigation.current);
  const value = useMemo<NavigationContextValue>(() => {
    const route = parseRoute(path);
    return {
      route,
      navigate: (next) => {
        if (!sameRoute(next, route)) navigation.push(routePath(next));
      },
      back: () => {
        if (!navigation.back()) navigation.replace(routePath(parentRoute(route)));
      },
    };
  }, [navigation, path]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
