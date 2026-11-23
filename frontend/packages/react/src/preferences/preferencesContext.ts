import type { Locale, ResolvedMode, ThemePreference } from '@process-flow/domain';
import { createContext, useContext } from 'react';

export interface PreferencesValue {
  readonly locale: Locale;
  readonly themePreference: ThemePreference;
  readonly systemMode: ResolvedMode;
  readonly resolvedMode: ResolvedMode;
  readonly setLocale: (locale: Locale) => void;
  readonly setThemePreference: (preference: ThemePreference) => void;
}

export const PreferencesContext = createContext<PreferencesValue | null>(null);

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error('usePreferences는 PreferencesProvider 안에서만 쓸 수 있습니다.');
  }
  return value;
}
