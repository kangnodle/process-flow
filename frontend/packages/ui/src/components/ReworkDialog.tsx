import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  MessageBar,
  MessageBarBody,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { ReworkPreview } from '@process-flow/domain';
import { useState } from 'react';
import { useI18n } from '../i18n/useI18n';

const useStyles = makeStyles({
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

interface ReworkDialogProps {
  readonly preview: ReworkPreview;
  readonly onConfirm: (reason: string) => void;
}

export function ReworkDialog({ preview, onConfirm }: ReworkDialogProps) {
  const styles = useStyles();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const revoked = preview.revokedApprovals.map((index) => index + 1).join(', ');

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        setOpen(data.open);
        if (!data.open) setReason('');
      }}
    >
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="subtle">{t.requestRework}</Button>
      </DialogTrigger>
      <DialogSurface>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            onConfirm(trimmed);
            setOpen(false);
            setReason('');
          }}
        >
          <DialogBody>
            <DialogTitle>{t.requestRework}</DialogTitle>
            <DialogContent className={styles.content}>
              <Text>{t.reworkDialogBody(preview.from.number, preview.through.number, preview.count)}</Text>
              {revoked && (
                <MessageBar intent="warning">
                  <MessageBarBody>{t.reworkRevokes(revoked)}</MessageBarBody>
                </MessageBar>
              )}
              <Field label={t.reworkReason} required>
                <Textarea
                  rows={3}
                  value={reason}
                  placeholder={t.reworkReasonPlaceholder}
                  onChange={(_, data) => setReason(data.value)}
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button>{t.cancel}</Button>
              </DialogTrigger>
              <Button type="submit" appearance="primary" disabled={!trimmed}>
                {t.reworkConfirm}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
