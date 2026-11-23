import {
  Badge,
  Body1Strong,
  Button,
  Caption1,
  Field,
  Select,
  Spinner,
  Subtitle2,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { Delete20Regular, PersonAdd20Regular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { ROLES, isRole, type Role } from '@process-flow/domain';
import { errorKindOf, type RequestErrorKind, type MemberManagement } from '@process-flow/application';
import { useManagementQuery } from '@process-flow/react';
import { useI18n } from '../i18n/useI18n';
import { InlineError } from './InlineError';

const useStyles = makeStyles({
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  note: { color: tokens.colorNeutralForeground3 },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  list: { listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  hoverRow: {
    marginLeft: `calc(${tokens.spacingHorizontalS} * -1)`,
    marginRight: `calc(${tokens.spacingHorizontalS} * -1)`,
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalS,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  itemText: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS, minWidth: 0, flexGrow: 1 },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  role: { width: '120px' },
  addForm: { display: 'flex', alignItems: 'flex-end', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  grow: { flexGrow: 1, minWidth: '160px' },
});

type MemberAction = 'add' | 'changeRole' | 'remove';

interface ProjectMembersProps {
  readonly management: MemberManagement;
  readonly projectId: string;
  readonly canManage: boolean;
  readonly onChanged?: () => void;
}

export function ProjectMembers({ management, projectId, canManage, onChanged }: ProjectMembersProps) {
  const styles = useStyles();
  const { t } = useI18n();
  const query = useMemo(() => management.observeDirectory(), [management]);
  const directoryState = useManagementQuery(query, projectId);
  const directory = 'data' in directoryState ? directoryState.data : undefined;
  const members = directory?.members;
  const candidates = directory?.candidates ?? [];
  const loadError = directoryState.status === 'failed' ? directoryState.error : undefined;
  const load = query.reload;
  const context = { projectId, canManage };
  const [error, setError] = useState<{ action: MemberAction; kind: RequestErrorKind } | undefined>();
  const [busy, setBusy] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<Role>('editor');

  const run = async (action: MemberAction, request: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await request();
      load();
      onChanged?.();
      return true;
    } catch (reason) {
      setError({ action, kind: errorKindOf(reason) });
      load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const errorText = (action: MemberAction, kind: RequestErrorKind) => {
    if (kind !== 'conflict') return t.projectError[kind];
    return action === 'add' ? t.inactiveCannotJoin : t.lastOwner;
  };

  const memberIds = new Set(members?.map((member) => member.user.id));
  const addable = candidates.filter((user) => !memberIds.has(user.id));

  return (
    <section aria-labelledby="project-members" className={styles.section}>
      <Subtitle2 as="h2" id="project-members" block>
        {t.members}
      </Subtitle2>
      <Caption1 className={styles.note}>{t.rolesExplained}</Caption1>
      {!canManage && (
        <Caption1 className={styles.note} block>
          {t.membersOwnerOnly}
        </Caption1>
      )}
      {loadError && <InlineError message={t.projectError[loadError]} onRetry={load} />}
      {!members && !loadError && <Spinner size="small" label={t.loading} />}
      {members && members.length === 0 && <Caption1 className={styles.note}>{t.noMembers}</Caption1>}
      {members && members.length > 0 && (
        <ul className={styles.list} aria-label={t.members}>
          {members.map(({ user, role }) => (
            <li key={user.id} className={mergeClasses(styles.item, styles.hoverRow)}>
              <span className={styles.itemText}>
                <span className={styles.row}>
                  <Body1Strong className={styles.ellipsis}>{user.name}</Body1Strong>
                  {!user.active && (
                    <Badge appearance="tint" color="subtle">
                      {t.badgeInactive}
                    </Badge>
                  )}
                </span>
                <Caption1 className={mergeClasses(styles.note, styles.ellipsis)}>{user.email}</Caption1>
              </span>
              {canManage ? (
                <>
                  <Select
                    className={styles.role}
                    aria-label={t.roleFor(user.name)}
                    value={role}
                    disabled={busy}
                    onChange={(_, data) => {
                      if (isRole(data.value) && data.value !== role) {
                        void run('changeRole', () => management.put(context, user.id, data.value as Role));
                      }
                    }}
                  >
                    {ROLES.map((option) => (
                      <option key={option} value={option}>
                        {t.roleLabel[option]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    appearance="subtle"
                    icon={<Delete20Regular />}
                    aria-label={t.removeMember(user.name)}
                    disabled={busy}
                    onClick={() => void run('remove', () => management.remove(context, user.id))}
                  />
                </>
              ) : (
                <Badge appearance="outline" color="informative">
                  {t.roleLabel[role]}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <InlineError message={errorText(error.action, error.kind)} />}
      {members &&
        canManage &&
        (addable.length === 0 ? (
          <Caption1 className={styles.note}>{t.noUsersToAdd}</Caption1>
        ) : (
          <form
            className={styles.addForm}
            aria-label={t.addMember}
            onSubmit={(event) => {
              event.preventDefault();
              if (!newUserId) return;
              void run('add', () => management.put(context, newUserId, newRole)).then((ok) => {
                if (!ok) return;
                setNewUserId('');
                setNewRole('editor');
              });
            }}
          >
            <Field label={t.memberUser} className={styles.grow}>
              <Select value={newUserId} onChange={(_, data) => setNewUserId(data.value)}>
                <option value="">{t.chooseUser}</option>
                {addable.map((user) => (
                  <option key={user.id} value={user.id}>
                    {`${user.name} (${user.email})`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.memberRole}>
              <Select
                className={styles.role}
                value={newRole}
                onChange={(_, data) => {
                  if (isRole(data.value)) setNewRole(data.value);
                }}
              >
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {t.roleLabel[option]}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" icon={<PersonAdd20Regular />} disabled={busy || !newUserId}>
              {t.addMember}
            </Button>
          </form>
        ))}
    </section>
  );
}
