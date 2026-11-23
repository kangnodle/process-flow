import {
  initialPreferences,
  resolveMode,
  type Locale,
  type StoredPreferences,
  type ThemePreference,
} from '@process-flow/domain';
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ColorSchemeSource } from '@process-flow/application';
import { PreferencesContext, type PreferencesValue } from './preferencesContext';

interface PreferencesProviderProps {
  readonly colorScheme: ColorSchemeSource;
  readonly preferredLanguages: readonly string[];
  readonly initial?: Partial<StoredPreferences>;
  readonly remote?: Partial<StoredPreferences>;
  readonly onChange?: (patch: Partial<StoredPreferences>) => void;
  readonly children: ReactNode;
}

export function PreferencesProvider({
  colorScheme,
  preferredLanguages,
  initial,
  remote,
  onChange,
  children,
}: PreferencesProviderProps) {
  const [start] = useState(() => initialPreferences(initial, preferredLanguages));
  const [locale, setLocaleState] = useState<Locale>(start.locale);
  const [themePreference, setThemeState] = useState<ThemePreference>(start.theme);
  const [touched, setTouched] = useState(false);
  const [appliedRemote, setAppliedRemote] = useState<Partial<StoredPreferences>>();
  if (remote && !appliedRemote) {
    setAppliedRemote(remote);
    if (!touched && (remote.locale || remote.theme)) {
      setLocaleState((!initial?.locale && remote.locale) || locale);
      setThemeState((!initial?.theme && remote.theme) || themePreference);
    }
  }
  const systemMode = useSyncExternalStore(colorScheme.subscribe, colorScheme.current);

  const value = useMemo<PreferencesValue>(
    () => ({
      locale,
      themePreference,
      systemMode,
      resolvedMode: resolveMode(themePreference, systemMode),
      setLocale: (next) => {
        setTouched(true);
        setLocaleState(next);
        onChange?.({ locale: next });
      },
      setThemePreference: (next) => {
        setTouched(true);
        setThemeState(next);
        onChange?.({ theme: next });
      },
    }),
    [locale, themePreference, systemMode, onChange],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}
