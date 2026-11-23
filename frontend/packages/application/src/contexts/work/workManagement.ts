import type { WorkItem } from '@process-flow/domain';
import type { ManagementQuery } from '../projects/managementQuery';

export interface WorkManagement {
  observe(): ManagementQuery<void, readonly WorkItem[]>;
}
