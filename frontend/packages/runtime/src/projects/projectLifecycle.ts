import type { ProjectEffectScope } from '@process-flow/application';

export interface ProjectLifecycle extends ProjectEffectScope {
  start(): void;
  stop(): void;
}

export function createProjectLifecycle(): ProjectLifecycle {
  let active = false;
  let generation = 0;
  return {
    start: () => {
      active = true;
      generation += 1;
    },
    stop: () => {
      active = false;
      generation += 1;
    },
    capture: () => generation,
    isCurrent: (requestGeneration) => active && requestGeneration === generation,
  };
}
