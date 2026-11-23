import { MessageBar, MessageBarBody, MessageBarTitle } from '@fluentui/react-components';
import { completedCount } from '@process-flow/domain';
import { shallowEqual, useWorkflowSelector } from '@process-flow/react';
import { useI18n } from '../i18n/useI18n';

export function ReworkBanner({ className }: { readonly className?: string }) {
  const rework = useWorkflowSelector(
    ({ process, state }) => state.rework && { from: completedCount(process, state.phase) + 1, ...state.rework },
    shallowEqual,
  );
  const { t } = useI18n();
  if (!rework) return null;
  return (
    <MessageBar intent="warning" className={className}>
      <MessageBarBody>
        <MessageBarTitle>{t.reworkBannerTitle}</MessageBarTitle>
        {t.reworkBannerBody(rework.from, rework.untilNumber, rework.reason)}
      </MessageBarBody>
    </MessageBar>
  );
}
