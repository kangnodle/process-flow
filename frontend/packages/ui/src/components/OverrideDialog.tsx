import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from '@fluentui/react-components';
import { shallowEqual, useWorkflowSelector } from '@process-flow/react';
import { namesOf } from '../i18n/actionBlockText';
import { useI18n } from '../i18n/useI18n';
import { useMemberNames } from '../i18n/useMemberNames';

export function OverrideDialog() {
  const { pendingOverride, confirmOverride, cancelOverride } = useWorkflowSelector(
    ({ pendingOverride, confirmOverride, cancelOverride }) => ({ pendingOverride, confirmOverride, cancelOverride }),
    shallowEqual,
  );
  const { t } = useI18n();
  const nameOf = useMemberNames();
  return (
    <Dialog
      open={pendingOverride !== undefined}
      onOpenChange={(_, data) => {
        if (!data.open) cancelOverride?.();
      }}
    >
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t.overrideTitle}</DialogTitle>
          <DialogContent>
            {pendingOverride && t.overrideBody(namesOf(pendingOverride.assignees, nameOf, t))}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => cancelOverride?.()}>{t.cancel}</Button>
            <Button appearance="primary" onClick={() => confirmOverride?.()}>
              {t.overrideConfirm}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
