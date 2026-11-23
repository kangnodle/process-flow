import type { Locale, ResolvedMode } from '@process-flow/domain';
import type { Platform } from '@process-flow/application';

export interface FakePlatform extends Platform {
  readonly language: () => Locale | undefined;
  readonly title: () => string | undefined;
  readonly setSystemMode: (mode: ResolvedMode) => void;
}

interface FakePlatformOptions {
  readonly systemMode?: ResolvedMode;
  readonly preferredLanguages?: readonly string[];
}

export function createFakePlatform({
  systemMode = 'light',
  preferredLanguages = ['ko-KR'],
}: FakePlatformOptions = {}): FakePlatform {
  let language: Locale | undefined;
  let title: string | undefined;
  let mode = systemMode;
  const listeners = new Set<() => void>();

  return {
    scheduler: {
      schedule(callback, delayMs) {
        const handle = setTimeout(callback, delayMs);
        return () => clearTimeout(handle);
      },
    },
    colorScheme: {
      current: () => mode,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    document: {
      setLanguage: (locale) => {
        language = locale;
      },
      setTitle: (value) => {
        title = value;
      },
    },
    preferredLanguages,
    language: () => language,
    title: () => title,
    setSystemMode: (next) => {
      mode = next;
      listeners.forEach((listener) => listener());
    },
  };
}
