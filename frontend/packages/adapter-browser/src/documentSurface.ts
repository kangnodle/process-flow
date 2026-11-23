import type { DocumentSurface } from '@process-flow/application';

export function createDocumentSurface(doc: Document): DocumentSurface {
  return {
    setLanguage(locale) {
      doc.documentElement.lang = locale;
    },
    setTitle(title) {
      doc.title = title;
    },
  };
}
