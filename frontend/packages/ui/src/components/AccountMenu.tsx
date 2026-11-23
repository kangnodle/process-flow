import {
  Avatar,
  Button,
  CounterBadge,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Persona,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Key20Regular, SignOut20Regular, TaskListLtr20Regular } from '@fluentui/react-icons';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@process-flow/react';
import { errorKindOf, isValidPassword, PASSWORD_MIN, type RequestErrorKind } from '@process-flow/application';
import { useI18n } from '../i18n/useI18n';
import { InlineError } from './InlineError';

const useStyles = makeStyles({
  content: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  trigger: { position: 'relative', overflow: 'visible', minWidth: 'auto', padding: tokens.spacingHorizontalXXS },
  triggerBadge: {
    position: 'absolute',
    top: `calc(${tokens.spacingVerticalXXS} * -1)`,
    right: `calc(${tokens.spacingHorizontalXXS} * -1)`,
    pointerEvents: 'none',
    boxShadow: `0 0 0 ${tokens.strokeWidthThick} ${tokens.colorNeutralBackground1}`,
  },
  popover: { minWidth: '280px', maxWidth: '360px' },
  profile: {
    paddingTop: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalM,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
    minWidth: 0,
  },
  profileText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

interface AccountMenuProps {
  readonly onPasswordChanged: () => void;
  readonly myWork?: {
    readonly readyCount: number;
    readonly onOpen: () => void;
    readonly current?: boolean;
  };
}

export function AccountMenu({ onPasswordChanged, myWork }: AccountMenuProps) {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const [changing, setChanging] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  if (!auth) return null;
  const { user } = auth;
  const readyCount = myWork?.readyCount ?? 0;
  const label = readyCount > 0 ? `${t.accountMenu(user.name)}, ${t.myWorkCount(readyCount)}` : t.accountMenu(user.name);
  return (
    <>
      <Menu positioning={{ position: 'below', align: 'end' }}>
        <Tooltip content={user.name} relationship="description" withArrow>
          <MenuTrigger disableButtonEnhancement>
            <Button appearance="subtle" shape="circular" className={styles.trigger} aria-label={label}>
              <Avatar name={user.name} color="colorful" size={28} aria-hidden />
              {readyCount > 0 && (
                <CounterBadge
                  className={styles.triggerBadge}
                  count={readyCount}
                  overflowCount={99}
                  size="small"
                  appearance="filled"
                  color="brand"
                  aria-hidden
                />
              )}
            </Button>
          </MenuTrigger>
        </Tooltip>
        <MenuPopover className={styles.popover}>
          <div className={styles.profile}>
            <Persona
              size="large"
              name={user.name}
              avatar={{ color: 'colorful' }}
              primaryText={{ className: styles.profileText }}
              secondaryText={{ children: user.email, className: styles.profileText }}
              {...(user.isAdmin ? { tertiaryText: t.systemAdmin } : {})}
            />
          </div>
          <MenuDivider />
          <MenuList>
            {myWork && (
              <>
                <MenuItem
                  icon={<TaskListLtr20Regular />}
                  {...(myWork.current ? { 'aria-current': 'page' as const } : {})}
                  {...(readyCount > 0
                    ? {
                        secondaryContent: (
                          <CounterBadge
                            count={readyCount}
                            overflowCount={99}
                            size="small"
                            appearance="filled"
                            color="brand"
                            aria-label={t.myWorkCount(readyCount)}
                          />
                        ),
                      }
                    : {})}
                  onClick={myWork.onOpen}
                >
                  {t.myWork}
                </MenuItem>
                <MenuDivider />
              </>
            )}
            <MenuItem icon={<Key20Regular />} aria-haspopup="dialog" onClick={() => setChanging(true)}>
              {t.changePassword}
            </MenuItem>
            <MenuDivider />
            <MenuItem
              icon={<SignOut20Regular />}
              onClick={() => {
                setLogoutFailed(false);
                void auth.logout().catch(() => setLogoutFailed(true));
              }}
            >
              {t.signOut}
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
      {logoutFailed && (
        <InlineError
          message={t.signOutFailed}
          onRetry={() => {
            setLogoutFailed(false);
            void auth.logout().catch(() => setLogoutFailed(true));
          }}
        />
      )}
      <Dialog open={changing} onOpenChange={(_, data) => setChanging(data.open)}>
        <DialogSurface>
          {changing && (
            <ChangePasswordForm
              change={auth.changePassword}
              onCancel={() => setChanging(false)}
              onDone={() => {
                setChanging(false);
                onPasswordChanged();
              }}
            />
          )}
        </DialogSurface>
      </Dialog>
    </>
  );
}

function ChangePasswordForm({
  change,
  onCancel,
  onDone,
}: {
  readonly change: (current: string, next: string) => Promise<void>;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorKind | undefined>();
  const weak = !isValidPassword(next);
  const mismatch = next !== confirm;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!current || weak || mismatch) return;
    setBusy(true);
    setError(undefined);
    try {
      await change(current, next);
      onDone();
    } catch (reason) {
      setError(errorKindOf(reason));
      setBusy(false);
    }
  };

  const invalidField = (show: boolean, message: string) =>
    touched && show ? { validationState: 'error' as const, validationMessage: message } : {};
  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <DialogBody>
        <DialogTitle>{t.changePassword}</DialogTitle>
        <DialogContent className={styles.content}>
          <Field label={t.currentPassword} required>
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(_, data) => setCurrent(data.value)}
              autoFocus
            />
          </Field>
          <Field label={t.newPassword} required {...invalidField(weak, t.passwordRule(PASSWORD_MIN))}>
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(_, data) => setNext(data.value)}
            />
          </Field>
          <Field label={t.passwordConfirm} required {...invalidField(!weak && mismatch, t.passwordMismatch)}>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(_, data) => setConfirm(data.value)}
            />
          </Field>
          {error && <InlineError message={error === 'invalid' ? t.wrongCurrentPassword : t.authError[error]} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel} disabled={busy}>
            {t.cancel}
          </Button>
          <Button type="submit" appearance="primary" disabled={busy || !current}>
            {t.changePassword}
          </Button>
        </DialogActions>
      </DialogBody>
    </form>
  );
}
