export type RequestErrorKind =
  | 'invalid'
  | 'notFound'
  | 'versionConflict'
  | 'conflict'
  | 'unauthenticated'
  | 'invalidCredentials'
  | 'tooManyAttempts'
  | 'forbidden'
  | 'unknown';
export class RequestError extends Error {
  readonly kind: RequestErrorKind;
  constructor(kind: RequestErrorKind, message: string) {
    super(message);
    this.name = 'RequestError';
    this.kind = kind;
  }
}
export const errorKindOf = (error: unknown): RequestErrorKind =>
  error instanceof RequestError ? error.kind : 'unknown';
