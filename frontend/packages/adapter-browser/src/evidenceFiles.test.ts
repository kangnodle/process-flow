import { expect, it, vi } from 'vitest';
import * as browser from './index';

it('reads bounded file bytes into base64 and rejects oversized files', async () => {
  expect(typeof browser.createEvidenceFiles).toBe('function');
  const files = browser.createEvidenceFiles();
  await expect(files.read(new File(['hello'], 'notes.txt', { type: 'text/plain' }))).resolves.toEqual({
    fileName: 'notes.txt',
    mediaType: 'text/plain',
    size: 5,
    base64: 'aGVsbG8=',
  });
  await expect(files.read(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'huge.bin'))).rejects.toThrow('2 MiB');
});

it('downloads as an attachment using a transient blob URL and a sanitized filename', () => {
  expect(typeof browser.createEvidenceFiles).toBe('function');
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:test');
  const revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  let downloaded: { name: string; href: string } | undefined;
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloaded = { name: this.download, href: this.href };
  });
  browser.createEvidenceFiles().download({ fileName: '../notes.html', mediaType: 'text/html', base64: 'aGk=' });
  expect(downloaded?.name).toBe('notes.html');
  expect(downloaded?.href).toBe('blob:test');
  expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  click.mockRestore();
  vi.unstubAllGlobals();
});
