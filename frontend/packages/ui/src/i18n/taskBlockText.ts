import type { TaskDef } from '@process-flow/domain';
import type { TaskBlock } from '@process-flow/application';
import type { Messages } from './messages';

export function taskBlockText(block: TaskBlock, t: Messages, taskName: (task: TaskDef) => string): string {
  switch (block.kind) {
    case 'stageLocked':
      return t.taskStartsAfter(block.stageIndex);
    case 'waitForPrevious':
      return t.waitForPrevious(block.due.number, taskName(block.due));
    case 'onlyLastReopenable':
      return t.onlyLastReopenable(block.last.number, taskName(block.last));
  }
}
