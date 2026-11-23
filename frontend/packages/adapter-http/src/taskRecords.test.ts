import { expect, it } from 'vitest';
import { decodeTaskRecords } from './taskRecords';

it('preserves existing record document and link and file evidence JSON', () => {
  const records = {
    goals: {
      link: '',
      note: 'research',
      document: { version: 1, answers: { problem: 'Known problem' }, reviewStatus: 'passed' },
      evidence: [
        { id: 'link', kind: 'link', title: 'Report', description: '', url: 'https://example.com' },
        { id: 'file', kind: 'file', title: 'Result', description: '', fileName: 'result.txt', size: 1, base64: 'YQ==' },
      ],
    },
  };
  expect(decodeTaskRecords(records)).toEqual(records);
  expect(JSON.stringify(decodeTaskRecords(records))).toBe(JSON.stringify(records));
});

it('rejects mixed evidence variants and unknown review states at the adapter boundary', () => {
  const link = {
    id: 'link',
    kind: 'link',
    title: 'Report',
    description: '',
    url: 'https://example.com',
    base64: 'YQ==',
  };
  expect(() => decodeTaskRecords({ goals: { link: '', note: '', evidence: [link] } })).toThrow(
    'Invalid workflow record',
  );
  expect(() =>
    decodeTaskRecords({
      goals: { link: '', note: '', document: { version: 1, answers: {}, reviewStatus: 'unknown' } },
    }),
  ).toThrow('Invalid workflow record');
});
