import type { WorkItem } from '@process-flow/domain';

export interface WorkRepository {
  mine(): Promise<readonly WorkItem[]>;
}
