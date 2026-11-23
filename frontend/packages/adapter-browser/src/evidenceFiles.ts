import type { EvidenceFiles } from '@process-flow/application';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const safeName = (name: string) =>
  [...(name.split(/[\\/]/).at(-1) ?? '')]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('') || 'attachment';

export function createEvidenceFiles(): EvidenceFiles {
  return {
    async read(file) {
      if (file.size > MAX_FILE_BYTES) throw new Error('Files must be no larger than 2 MiB.');
      if (!(file instanceof File)) throw new Error('Choose a local file to attach.');
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read the file. Please select it again.'));
        reader.onabort = () => reject(new Error('File reading was cancelled.'));
        reader.onload = () => {
          if (typeof reader.result !== 'string' || !reader.result.includes(',')) {
            reject(new Error('Invalid file read result.'));
            return;
          }
          resolve(reader.result.slice(reader.result.indexOf(',') + 1));
        };
        reader.readAsDataURL(file);
      });
      return {
        fileName: safeName(file.name),
        mediaType: file.type || 'application/octet-stream',
        size: file.size,
        base64,
      };
    },
    download(file) {
      if (file.base64.length > 4 * Math.ceil(MAX_FILE_BYTES / 3))
        throw new Error('Files must be no larger than 2 MiB.');
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safeName(file.fileName);
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
    createId: () => crypto.randomUUID(),
  };
}
