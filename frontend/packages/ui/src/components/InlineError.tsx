import { Button, MessageBar, MessageBarActions, MessageBarBody } from '@fluentui/react-components';
import { useI18n } from '../i18n/useI18n';

export function InlineError({ message, onRetry }: { readonly message: string; readonly onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <MessageBar intent="error">
      <MessageBarBody>{message}</MessageBarBody>
      {onRetry && (
        <MessageBarActions>
          <Button size="small" onClick={onRetry}>
            {t.retry}
          </Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}
