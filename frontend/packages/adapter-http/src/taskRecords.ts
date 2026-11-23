import type { Evidence, TaskDocument, TaskRecord } from '@process-flow/domain';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function document(value: unknown): value is TaskDocument {
  return (
    object(value) &&
    value.version === 1 &&
    object(value.answers) &&
    Object.values(value.answers).every((answer) => typeof answer === 'string') &&
    (value.reviewStatus === 'pending' || value.reviewStatus === 'passed' || value.reviewStatus === 'blocked')
  );
}

function evidence(value: unknown): value is Evidence {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string'
  )
    return false;
  if (value.kind === 'link')
    return (
      typeof value.url === 'string' &&
      [value.fileName, value.mediaType, value.size, value.base64].every((field) => field === undefined)
    );
  return (
    value.kind === 'file' &&
    value.url === undefined &&
    typeof value.fileName === 'string' &&
    typeof value.base64 === 'string' &&
    typeof value.size === 'number' &&
    Number.isSafeInteger(value.size) &&
    value.size >= 0 &&
    (value.mediaType === undefined || typeof value.mediaType === 'string')
  );
}

function record(value: unknown): value is TaskRecord {
  return (
    object(value) &&
    typeof value.link === 'string' &&
    typeof value.note === 'string' &&
    (value.document === undefined || document(value.document)) &&
    (value.evidence === undefined || (Array.isArray(value.evidence) && value.evidence.every(evidence)))
  );
}

export function decodeTaskRecords(value: unknown): Record<string, TaskRecord> {
  if (!object(value) || !Object.values(value).every(record)) throw new Error('Invalid workflow record');
  return value as Record<string, TaskRecord>;
}
