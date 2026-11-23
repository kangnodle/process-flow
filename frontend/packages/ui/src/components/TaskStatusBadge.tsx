import { Badge } from '@fluentui/react-components';
import type { TaskStatus } from '@process-flow/domain';
import { useI18n } from '../i18n/useI18n';

interface TaskStatusBadgeProps {
  readonly status: TaskStatus;
  readonly rework?: boolean;
}

export function TaskStatusBadge({ status, rework = false }: TaskStatusBadgeProps) {
  const { t } = useI18n();
  switch (status) {
    case 'locked':
      return (
        <Badge appearance="outline" color={rework ? 'warning' : 'informative'}>
          {rework ? t.statusLockedRework : t.statusLocked}
        </Badge>
      );
    case 'todo':
      return (
        <Badge appearance="ghost" color={rework ? 'warning' : 'informative'}>
          {rework ? t.statusRedoTodo : t.statusTodo}
        </Badge>
      );
    case 'doing':
      return (
        <Badge appearance="tint" color={rework ? 'warning' : 'brand'}>
          {rework ? t.statusRedoing : t.statusDoing}
        </Badge>
      );
    case 'done':
      return (
        <Badge appearance="tint" color="success">
          {t.statusDone}
        </Badge>
      );
  }
}
