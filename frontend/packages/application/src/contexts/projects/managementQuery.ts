import type { RequestErrorKind } from '../../errors';

export type ManagementLoadState<Value> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly data?: Value }
  | { readonly status: 'ready'; readonly data: Value }
  | { readonly status: 'failed'; readonly data?: Value; readonly error: RequestErrorKind };

export interface ManagementQuery<Input, Value> {
  getSnapshot(): ManagementLoadState<Value>;
  subscribe(listener: () => void): () => void;
  load(input: Input): void;
  reload(): void;
  cancel(): void;
  replace(value: Value): void;
  updateData(update: (value: Value, input: Input) => Value): void;
}
