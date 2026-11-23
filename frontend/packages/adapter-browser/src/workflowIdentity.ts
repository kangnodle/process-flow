function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function createWorkflowIdentity() {
  const storage = safeLocalStorage();
  return {
    load(): string | undefined {
      const fromUrl = new URL(window.location.href).searchParams.get('workflow');
      if (fromUrl) return fromUrl;
      try {
        return storage?.getItem('process-flow:workflow') ?? undefined;
      } catch {
        return undefined;
      }
    },
    save(id: string) {
      const url = new URL(window.location.href);
      url.searchParams.set('workflow', id);
      window.history.replaceState(window.history.state, '', url);
      try {
        storage?.setItem('process-flow:workflow', id);
      } catch {
        return;
      }
    },
    clear() {
      const url = new URL(window.location.href);
      url.searchParams.delete('workflow');
      window.history.replaceState(window.history.state, '', url);
      try {
        storage?.removeItem('process-flow:workflow');
      } catch {
        return;
      }
    },
  };
}
