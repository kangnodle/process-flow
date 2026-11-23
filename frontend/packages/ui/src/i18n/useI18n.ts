import {
  stageText,
  taskText,
  type Locale,
  type StageDef,
  type StageText,
  type TaskDef,
  type TaskText,
} from '@process-flow/domain';
import { useContext, useMemo } from 'react';
import { usePreferences } from '@process-flow/react';
import { ProcessTextContext } from './i18nContext';
import { MESSAGES, type Messages } from './messages';

export interface I18n {
  readonly locale: Locale;
  readonly t: Messages;
  readonly st: (stage: StageDef) => StageText;
  readonly tt: (task: TaskDef) => TaskText;
}

export function useI18n(): I18n {
  const { locale } = usePreferences();
  const catalog = useContext(ProcessTextContext);
  if (!catalog) {
    throw new Error('useI18n은 <ProcessTextContext.Provider> 안에서만 쓸 수 있습니다.');
  }
  return useMemo(() => {
    const text = catalog[locale];
    return {
      locale,
      t: MESSAGES[locale],
      st: (stage) => stageText(text, stage),
      tt: (task) => taskText(text, task),
    };
  }, [locale, catalog]);
}
