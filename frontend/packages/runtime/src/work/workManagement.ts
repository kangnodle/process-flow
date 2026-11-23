import type { WorkManagement, WorkRepository } from '@process-flow/application';
import { createManagementQuery } from '../projects/managementQuery';

export function createWorkManagement(repository: WorkRepository): WorkManagement {
  return { observe: () => createManagementQuery(() => repository.mine()) };
}
