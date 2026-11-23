import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { STANDARD_PROCESS, createInitialState, getRecord, type WorkflowAction } from '@process-flow/domain';
import { WorkflowProvider, shallowEqual, useWorkflow, useWorkflowSelector } from '@process-flow/react';
import { createFakePlatform } from './fakePlatform';

describe('useWorkflowSelector', () => {
  it('상태 변경 없이 작업 props가 바뀌어도 새 기록을 선택하고 다른 기록 수정은 무시한다', () => {
    let dispatch: (action: WorkflowAction) => void = () => undefined;
    let renders = 0;
    const first = STANDARD_PROCESS.tasks[0]!.id;
    const second = STANDARD_PROCESS.tasks[1]!.id;
    function Record({ taskId }: { taskId: string }) {
      renders += 1;
      const record = useWorkflowSelector(({ state }) => getRecord(state, taskId));
      return <p>{record.note || 'empty'}</p>;
    }
    function Dispatcher() {
      dispatch = useWorkflow().dispatch;
      return null;
    }
    const scheduler = createFakePlatform().scheduler;
    const tree = (taskId: string) => (
      <WorkflowProvider
        process={STANDARD_PROCESS}
        scheduler={scheduler}
        initialState={createInitialState(STANDARD_PROCESS)}
      >
        <Record taskId={taskId} />
        <Dispatcher />
      </WorkflowProvider>
    );
    const { rerender } = render(tree(first));
    act(() => dispatch({ type: 'updateRecord', taskId: first, patch: { note: 'first' } }));
    act(() => dispatch({ type: 'updateRecord', taskId: second, patch: { note: 'second' } }));
    rerender(tree(second));
    expect(screen.getByText('second')).toBeInTheDocument();
    const before = renders;
    act(() => dispatch({ type: 'updateRecord', taskId: first, patch: { note: 'changed' } }));
    expect(renders).toBe(before);
  });

  it('고른 값이 그대로면 기록을 고쳐도 다시 그리지 않는다', () => {
    let renders = 0;
    let dispatch: (action: WorkflowAction) => void = () => undefined;
    function ViewName() {
      renders += 1;
      const { view } = useWorkflowSelector(({ state }) => ({ view: state.view }), shallowEqual);
      return <p>{view}</p>;
    }
    function Dispatcher() {
      dispatch = useWorkflow().dispatch;
      return null;
    }
    const taskId = STANDARD_PROCESS.tasks[0]!.id;
    render(
      <WorkflowProvider
        process={STANDARD_PROCESS}
        scheduler={createFakePlatform().scheduler}
        initialState={createInitialState(STANDARD_PROCESS, 'stage')}
      >
        <ViewName />
        <Dispatcher />
      </WorkflowProvider>,
    );
    expect(screen.getByText('stage')).toBeInTheDocument();
    const before = renders;

    act(() => dispatch({ type: 'updateRecord', taskId, patch: { note: '한 글자' } }));
    act(() => dispatch({ type: 'updateRecord', taskId, patch: { note: '한 글자씩' } }));
    expect(renders).toBe(before);

    act(() => dispatch({ type: 'setView', view: 'board' }));
    expect(screen.getByText('board')).toBeInTheDocument();
    expect(renders).toBe(before + 1);
  });
});
