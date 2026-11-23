import { createContext, useContext } from 'react';
import type { Route } from '@process-flow/application';

export interface NavigationContextValue {
  readonly route: Route;
  readonly navigate: (route: Route) => void;
  readonly back: () => void;
}

export const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigation(): NavigationContextValue {
  const value = useContext(NavigationContext);
  if (!value) throw new Error('useNavigation은 NavigationProvider 안에서만 쓸 수 있습니다.');
  return value;
}
