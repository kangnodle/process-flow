import { useMemo } from 'react';
import type { WorkItem } from '@process-flow/domain';
import type { WorkManagement } from '@process-flow/application';
import { useManagementQuery } from '../projects/useManagementQuery';

export interface MyWorkState {
  readonly items?: readonly WorkItem[];
  readonly failed: boolean;
  readonly reload: () => void;
}

const ignoreReload = () => undefined;

export function useMyWork(management: WorkManagement | undefined, refreshKey: unknown): MyWorkState {
  const query = useMemo(() => management?.observe(), [management]);
  const state = useManagementQuery(query, undefined, refreshKey);
  return {
    ...('data' in state && state.data ? { items: state.data } : {}),
    failed: state.status === 'failed',
    reload: query?.reload ?? ignoreReload,
  };
}
