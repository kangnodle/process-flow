import type { Scheduler } from '@process-flow/application';

export const timerScheduler: Scheduler = {
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};
