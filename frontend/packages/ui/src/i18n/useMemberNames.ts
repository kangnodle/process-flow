import { useCallback, useMemo } from 'react';
import { useProjects } from '@process-flow/react';

export function useMemberNames(): (id: string) => string | undefined {
  const members = useProjects()?.members;
  const names = useMemo(() => new Map(members?.map((member) => [member.user.id, member.user.name])), [members]);
  return useCallback((id: string) => names.get(id), [names]);
}
