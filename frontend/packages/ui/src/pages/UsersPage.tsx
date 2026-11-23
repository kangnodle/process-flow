import {
  Badge,
  Body1Strong,
  Button,
  Caption1,
  Field,
  Input,
  Spinner,
  Subtitle2,
  Switch,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { Add20Regular, Edit20Regular, PersonDelete20Regular, PersonAdd20Regular } from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useAuth, useManagementQuery, useProjects } from '@process-flow/react';
import {
  errorKindOf,
  isValidPassword,
  normalizeEmail,
  PASSWORD_MIN,
  type RequestErrorKind,
  USER_NAME_MAX,
  userFormIssues,
  type UserManagement,
} from '@process-flow/application';
import { type User } from '@process-flow/domain';
import { useI18n } from '../i18n/useI18n';
import { useFocusOnClose } from '../components/drawerFocus';
import { InlineError } from '../components/InlineError';
import { PageLayout } from './PageLayout';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  note: { color: tokens.colorNeutralForeground3 },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  spacer: { flexGrow: 1 },
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
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

export function UsersPage() {
  const users = useProjects()?.users;
  const { t } = useI18n();
  if (!users) return null;
  return (
    <PageLayout title={t.users} description={t.usersDescription}>
      <UserList users={users} />
    </PageLayout>
  );
}

type Conflict = 'duplicateEmail' | 'lastAdmin';

function userErrorText(t: ReturnType<typeof useI18n>['t'], kind: RequestErrorKind, conflict: Conflict): string {
  return kind === 'conflict' ? t[conflict] : t.projectError[kind];
}

interface UserFormValues {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly isAdmin: boolean;
}

function UserForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly initial?: Pick<User, 'email' | 'name' | 'isAdmin'>;
  readonly submitLabel: string;
  readonly onSubmit: (values: UserFormValues) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const editing = Boolean(initial);
  const [email, setEmail] = useState(initial?.email ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(initial?.isAdmin ?? false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const issues = userFormIssues(email, name);
  const weakPassword = editing && !password ? false : !isValidPassword(password);
  const shown = touched ? issues : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(issues).length || weakPassword) return;
    setBusy(true);
    try {
      await onSubmit({ email: normalizeEmail(email), name: name.trim(), password, isAdmin });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <Field
        label={t.email}
        required
        {...(shown.email ? { validationState: 'error' as const, validationMessage: t.emailRule } : {})}
      >
        <Input type="email" value={email} onChange={(_, data) => setEmail(data.value)} autoFocus />
      </Field>
      <Field
        label={t.userName}
        required
        {...(shown.name ? { validationState: 'error' as const, validationMessage: t.userNameRule(USER_NAME_MAX) } : {})}
      >
        <Input value={name} onChange={(_, data) => setName(data.value)} />
      </Field>
      <Field
        label={editing ? t.resetPassword : t.initialPassword}
        required={!editing}
        hint={editing ? t.resetPasswordHint : t.initialPasswordHint}
        {...(touched && weakPassword
          ? { validationState: 'error' as const, validationMessage: t.passwordRule(PASSWORD_MIN) }
          : {})}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(_, data) => setPassword(data.value)}
        />
      </Field>
      {editing && <Switch checked={isAdmin} onChange={(_, data) => setIsAdmin(data.checked)} label={t.adminSwitch} />}
      <div className={styles.row}>
        <Button type="submit" appearance="primary" disabled={busy}>
          {submitLabel}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

function UserList({ users }: { readonly users: UserManagement }) {
  const styles = useStyles();
  const { t } = useI18n();
  const auth = useAuth();
  const canManage = auth ? auth.user.isAdmin : true;
  const [includeInactive, setIncludeInactive] = useState(false);
  const query = useMemo(() => users.observeList(), [users]);
  const listState = useManagementQuery(query, includeInactive);
  const items = 'data' in listState ? listState.data : undefined;
  const loadError = listState.status === 'failed' ? listState.error : undefined;
  const load = query.reload;
  const context = { canManage };
  const [passwordFailed, setPasswordFailed] = useState(false);
  const [error, setError] = useState<{ kind: RequestErrorKind; conflict: Conflict } | undefined>();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const newUserRef = useFocusOnClose(creating);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastEditedId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (editingId) lastEditedId.current = editingId;
    else if (lastEditedId.current) {
      editButtons.current.get(lastEditedId.current)?.focus();
      lastEditedId.current = undefined;
    }
  }, [editingId]);

  const run = async (action: () => Promise<unknown>, conflict: Conflict = 'duplicateEmail'): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    setPasswordFailed(false);
    try {
      await action();
      load();
      return true;
    } catch (reason) {
      const kind = errorKindOf(reason);
      setError({ kind, conflict });
      if (kind === 'versionConflict' || kind === 'notFound') load();
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.row}>
        <Switch
          checked={includeInactive}
          onChange={(_, data) => setIncludeInactive(data.checked)}
          label={t.showInactive}
        />
        <span className={styles.spacer} />
        {canManage && !creating && (
          <Button ref={newUserRef} icon={<Add20Regular />} onClick={() => setCreating(true)}>
            {t.newUser}
          </Button>
        )}
      </div>
      {creating && (
        <section aria-label={t.newUser}>
          <Subtitle2 as="h2" block>
            {t.newUser}
          </Subtitle2>
          <UserForm
            submitLabel={t.create}
            onCancel={() => {
              setCreating(false);
              setError(undefined);
            }}
            onSubmit={async ({ email, name, password }) => {
              if (await run(() => users.create({ email, name, password }, context))) setCreating(false);
            }}
          />
        </section>
      )}
      {!canManage && <Caption1 className={styles.note}>{t.adminOnly}</Caption1>}
      {passwordFailed && <InlineError message={t.userPasswordPartiallySaved} />}
      {error && <InlineError message={userErrorText(t, error.kind, error.conflict)} />}
      {loadError && <InlineError message={t.projectError[loadError]} onRetry={load} />}
      {!items && !loadError && <Spinner size="small" label={t.loading} />}
      {items && items.length === 0 && <Caption1 className={styles.note}>{t.noUsers}</Caption1>}
      {items && items.length > 0 && (
        <ul className={styles.list} aria-label={t.allUsers}>
          {items.map((user) =>
            user.id === editingId ? (
              <li key={user.id} className={styles.item}>
                <section aria-label={t.editUser(user.name)} className={styles.itemText}>
                  <UserForm
                    initial={user}
                    submitLabel={t.save}
                    onCancel={() => setEditingId(undefined)}
                    onSubmit={async ({ email, name, password, isAdmin }) => {
                      const conflict =
                        email === user.email && user.isAdmin && !isAdmin ? 'lastAdmin' : 'duplicateEmail';
                      setBusy(true);
                      setError(undefined);
                      setPasswordFailed(false);
                      try {
                        const result = await users.edit(user, { email, name, isAdmin }, password, context);
                        if (result.kind === 'failed') {
                          setError({ kind: result.error, conflict });
                          if (result.error === 'versionConflict' || result.error === 'notFound') load();
                        } else {
                          query.updateData((current) =>
                            current.map((item) => (item.id === result.user.id ? result.user : item)),
                          );
                          setEditingId(undefined);
                          setPasswordFailed(result.kind === 'passwordFailed');
                          load();
                        }
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </section>
              </li>
            ) : (
              <li key={user.id} className={mergeClasses(styles.item, styles.hoverRow)}>
                <span className={styles.itemText}>
                  <span className={styles.row}>
                    <Body1Strong className={styles.ellipsis}>{user.name}</Body1Strong>
                    {user.isAdmin && (
                      <Badge appearance="tint" color="brand">
                        {t.badgeAdmin}
                      </Badge>
                    )}
                    {!user.active && (
                      <Badge appearance="tint" color="subtle">
                        {t.badgeInactive}
                      </Badge>
                    )}
                  </span>
                  <Caption1 className={mergeClasses(styles.note, styles.ellipsis)}>{user.email}</Caption1>
                </span>
                {canManage && (
                  <>
                    <Button
                      ref={(node) => {
                        if (node) editButtons.current.set(user.id, node);
                        else editButtons.current.delete(user.id);
                      }}
                      appearance="subtle"
                      icon={<Edit20Regular />}
                      aria-label={t.editUser(user.name)}
                      disabled={busy}
                      onClick={() => setEditingId(user.id)}
                    />
                    <Button
                      appearance="subtle"
                      icon={user.active ? <PersonDelete20Regular /> : <PersonAdd20Regular />}
                      aria-label={user.active ? t.deactivateUser(user.name) : t.reactivateUser(user.name)}
                      disabled={busy}
                      onClick={() => void run(() => users.update(user, { active: !user.active }, context), 'lastAdmin')}
                    >
                      {user.active ? t.deactivate : t.reactivate}
                    </Button>
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      )}
    </>
  );
}
