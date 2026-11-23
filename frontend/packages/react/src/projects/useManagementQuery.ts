import { useEffect, useSyncExternalStore } from 'react';
import type { ManagementLoadState, ManagementQuery } from '@process-flow/application';

const IDLE = { status: 'idle' } as const;
const subscribeIdle = () => () => undefined;
const getIdleSnapshot = () => IDLE;

export function useManagementQuery<Input, Value>(
  query: ManagementQuery<Input, Value> | undefined,
  input: Input,
  refreshKey?: unknown,
): ManagementLoadState<Value> {
  const snapshot = useSyncExternalStore(query?.subscribe ?? subscribeIdle, query?.getSnapshot ?? getIdleSnapshot);
  useEffect(() => {
    query?.load(input);
    return () => query?.cancel();
  }, [query, input, refreshKey]);
  return snapshot;
}
