import { RequestError, type RequestErrorKind } from '@process-flow/application';

function errorKind(status: number, code: unknown): RequestErrorKind {
  if (code === 'versionConflict') return 'versionConflict';
  if (code === 'conflict') return 'conflict';
  if (code === 'invalidCredentials') return 'invalidCredentials';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'tooManyAttempts';
  if (status === 404) return 'notFound';
  if (status === 400) return 'invalid';
  return 'unknown';
}

export type JsonCall = (path: string, method?: string, body?: unknown) => Promise<unknown>;

export function createJsonCall(request: typeof fetch, base: string): JsonCall {
  return async (path, method = 'GET', body) => {
    let response: Response;
    try {
      response = await request(
        `${base}${path}`,
        body === undefined
          ? method === 'GET'
            ? {}
            : { method }
          : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
    } catch (error) {
      throw new RequestError('unknown', String(error));
    }
    if (!response.ok) {
      const envelope = (await response.json().catch(() => ({}))) as { error?: { code?: unknown; message?: unknown } };
      const message = typeof envelope.error?.message === 'string' ? envelope.error.message : `HTTP ${response.status}`;
      throw new RequestError(errorKind(response.status, envelope.error?.code), message);
    }
    return response.status === 204 ? undefined : response.json();
  };
}

export function decodeList<T>(value: unknown, decode: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new RequestError('unknown', 'Invalid list response');
  return value.map(decode);
}
