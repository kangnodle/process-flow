import { Tooltip } from '@fluentui/react-components';
import { type ReactElement, useState } from 'react';

interface DisabledReasonProps {
  readonly reason: string | null;
  readonly children: ReactElement;
}

export function DisabledReason({ reason, children }: DisabledReasonProps) {
  const [visible, setVisible] = useState(false);
  if (!reason && visible) setVisible(false);

  return (
    <Tooltip
      content={reason ?? ''}
      relationship="description"
      withArrow
      visible={Boolean(reason) && visible}
      onVisibleChange={(_, data) => setVisible(Boolean(reason) && data.visible)}
    >
      {children}
    </Tooltip>
  );
}
