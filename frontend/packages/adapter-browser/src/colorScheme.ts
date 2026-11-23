import type { ColorSchemeSource } from '@process-flow/application';
import type { ResolvedMode } from '@process-flow/domain';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function createMediaQueryColorScheme(matchMedia: (query: string) => MediaQueryList): ColorSchemeSource {
  const media = matchMedia(DARK_QUERY);
  const toMode = (dark: boolean): ResolvedMode => (dark ? 'dark' : 'light');
  return {
    current: () => toMode(media.matches),
    subscribe(listener) {
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
  };
}
