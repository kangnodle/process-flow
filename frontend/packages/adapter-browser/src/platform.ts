import { createEvidenceFiles } from './evidenceFiles';
import type { Platform } from '@process-flow/application';
import { createMediaQueryColorScheme } from './colorScheme';
import { createDocumentSurface } from './documentSurface';
import { createHashNavigation } from './hashNavigation';
import { timerScheduler } from './scheduler';
import { guardUnsavedChanges } from './unsavedGuard';

export function createBrowserPlatform(): Platform {
  const taskLayout = window.matchMedia('(max-width: 960px)');
  return {
    evidenceFiles: createEvidenceFiles(),
    guardUnsaved: guardUnsavedChanges,
    navigation: createHashNavigation(window),
    scheduler: timerScheduler,
    colorScheme: createMediaQueryColorScheme((query) => window.matchMedia(query)),
    compactTaskLayout: {
      current: () => taskLayout.matches,
      subscribe(listener) {
        taskLayout.addEventListener('change', listener);
        return () => taskLayout.removeEventListener('change', listener);
      },
    },
    document: createDocumentSurface(document),
    preferredLanguages: navigator.languages,
  };
}
