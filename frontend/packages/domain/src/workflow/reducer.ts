import { firstTaskOf, getStage, getTask, nextTask, type Process, type TaskId } from '../process/model';
import { approveStage, completeTask, completedCount, reachedNumber, reopenTask, rewindTo } from './phase';
import { validateTaskDocument } from '../process/taskForms';
import { getRecord, isDone, isTaskLocked } from './selectors';
import type { TaskRecord, WorkflowAction, WorkflowState } from './state';

export type WorkflowReducer = (state: WorkflowState, action: WorkflowAction) => WorkflowState;

function complete(process: Process, state: WorkflowState, taskId: TaskId): WorkflowState | null {
  getTask(process, taskId);
  if (validateTaskDocument(taskId, getRecord(state, taskId)).length) return null;
  const phase = completeTask(process, state.phase, taskId);
  if (!phase) return null;
  const rework = state.rework && state.rework.untilNumber > completedCount(process, phase) ? state.rework : null;
  return { ...state, phase, rework };
}

export function createWorkflowReducer(process: Process): WorkflowReducer {
  return function workflowReducer(state, action) {
    switch (action.type) {
      case 'setView':
        return state.view === action.view ? state : { ...state, view: action.view };

      case 'selectTask': {
        getTask(process, action.taskId);
        const view = action.view ?? state.view;
        if (state.selectedTaskId === action.taskId && state.view === view) {
          return state;
        }
        return { ...state, selectedTaskId: action.taskId, view };
      }

      case 'completeTask':
        return complete(process, state, action.taskId) ?? state;

      case 'completeAndNext': {
        const next = complete(process, state, action.taskId);
        if (!next) return state;
        const following = nextTask(process, action.taskId);
        const selectedTaskId = following && !isTaskLocked(process, next, following.id) ? following.id : action.taskId;
        return { ...next, selectedTaskId };
      }

      case 'reopenTask': {
        getTask(process, action.taskId);
        const reopened = reopenTask(process, state.phase, action.taskId);
        if (!reopened) return state;
        const next = { ...state, phase: reopened.phase };
        return isTaskLocked(process, next, state.selectedTaskId) ? { ...next, selectedTaskId: action.taskId } : next;
      }

      case 'approveStage': {
        const phase = approveStage(state.phase, action.stageIndex);
        if (!phase) return state;
        if (
          getStage(process, action.stageIndex).tasks.some(
            (task) => validateTaskDocument(task.id, getRecord(state, task.id)).length,
          )
        )
          return state;
        return { ...state, phase, selectedTaskId: firstTaskOf(process, action.stageIndex + 1).id };
      }

      case 'requestRework': {
        getTask(process, action.taskId);
        const reason = action.reason.trim();
        if (!reason) return state;
        const rewound = rewindTo(process, state.phase, action.taskId);
        if (!rewound) return state;
        const untilNumber = Math.max(reachedNumber(process, state.phase), state.rework?.untilNumber ?? 0);
        return { ...state, phase: rewound.phase, rework: { untilNumber, reason }, selectedTaskId: action.taskId };
      }

      case 'updateRecord': {
        getTask(process, action.taskId);
        if (isDone(process, state, action.taskId) || isTaskLocked(process, state, action.taskId)) return state;
        const current = getRecord(state, action.taskId);
        const merged: TaskRecord = {
          link: action.patch.link ?? current.link,
          note: action.patch.note ?? current.note,
          ...((action.patch.document ?? current.document)
            ? { document: action.patch.document ?? current.document }
            : {}),
          ...((action.patch.evidence ?? current.evidence)
            ? { evidence: action.patch.evidence ?? current.evidence }
            : {}),
        };
        if (
          merged.link === current.link &&
          merged.note === current.note &&
          merged.document === current.document &&
          merged.evidence === current.evidence
        ) {
          return state;
        }
        const reviewed =
          !action.patch.document && merged.document
            ? { ...merged, document: { ...merged.document, reviewStatus: 'pending' as const } }
            : merged;
        const records = { ...state.records, [action.taskId]: reviewed };
        if (!merged.link && !merged.note && !merged.document && !merged.evidence?.length) delete records[action.taskId];
        return { ...state, records };
      }

      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  };
}
