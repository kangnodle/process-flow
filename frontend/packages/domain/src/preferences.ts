import { detectLocale, type Locale } from './locale';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedMode = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const DEFAULT_THEME: ThemePreference = 'system';

export interface StoredPreferences {
  readonly locale: Locale;
  readonly theme: ThemePreference;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveMode(preference: ThemePreference, systemMode: ResolvedMode): ResolvedMode {
  return preference === 'system' ? systemMode : preference;
}

export function initialPreferences(
  override: Partial<StoredPreferences> | undefined,
  preferredLanguages: readonly string[],
): StoredPreferences {
  return {
    locale: override?.locale ?? detectLocale(preferredLanguages),
    theme: override?.theme ?? DEFAULT_THEME,
  };
}
