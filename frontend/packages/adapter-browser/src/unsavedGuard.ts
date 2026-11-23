export function guardUnsavedChanges(isUnsaved: () => boolean) {
  const listener = (event: BeforeUnloadEvent) => {
    if (isUnsaved()) {
      event.preventDefault();
      event.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', listener);
  return () => window.removeEventListener('beforeunload', listener);
}
