import type { ActionBlock } from '@process-flow/domain';
import type { Messages } from './messages';

export function namesOf(ids: readonly string[], nameOf: (id: string) => string | undefined, t: Messages): string {
  return ids.map((id) => nameOf(id) ?? t.unknownUser).join(', ');
}

export function actionBlockText(block: ActionBlock, t: Messages, nameOf: (id: string) => string | undefined): string {
  switch (block.kind) {
    case 'readOnly':
      return t.readOnlyReason;
    case 'notResponsible':
      return t.onlyResponsible(namesOf(block.users, nameOf, t));
    case 'notAccountable':
      return t.onlyAccountable(block.user ? (nameOf(block.user) ?? t.unknownUser) : t.unknownUser);
  }
}
