import { errorKindOf, type ManagementLoadState, type ManagementQuery } from '@process-flow/application';

export function createManagementQuery<Input, Value>(
  request: (input: Input) => Promise<Value>,
): ManagementQuery<Input, Value> {
  let snapshot: ManagementLoadState<Value> = { status: 'idle' };
  const listeners = new Set<() => void>();
  let generation = 0;
  let selected: { readonly input: Input } | undefined;
  const publish = (next: ManagementLoadState<Value>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const load = (input: Input) => {
    const requestId = ++generation;
    const previous = selected && Object.is(selected.input, input) && 'data' in snapshot ? snapshot.data : undefined;
    selected = { input };
    publish({ status: 'loading', ...(previous !== undefined ? { data: previous } : {}) });
    const execute = async () => request(input);
    void execute().then(
      (data) => {
        if (requestId === generation) publish({ status: 'ready', data });
      },
      (reason: unknown) => {
        if (requestId === generation)
          publish({
            status: 'failed',
            ...(previous !== undefined ? { data: previous } : {}),
            error: errorKindOf(reason),
          });
      },
    );
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    reload: () => {
      if (selected) load(selected.input);
    },
    cancel: () => {
      generation += 1;
    },
    replace: (data) => {
      generation += 1;
      publish({ status: 'ready', data });
    },
    updateData: (update) => {
      if (!selected || !('data' in snapshot) || snapshot.data === undefined) return;
      generation += 1;
      publish({ status: 'ready', data: update(snapshot.data, selected.input) });
    },
  };
}
