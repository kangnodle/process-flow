import {
  Body1,
  Button,
  Caption1,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Title3,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { LOCALES, isLocale } from '@process-flow/domain';
import { useState, type FormEvent } from 'react';
import { usePreferences, type AuthGate } from '@process-flow/react';
import {
  errorKindOf,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  PASSWORD_MIN,
  type RequestErrorKind,
  USER_NAME_MAX,
  userFormIssues,
} from '@process-flow/application';
import { InlineError } from '../components/InlineError';
import { LOCALE_ENDONYM } from '../i18n/messages';
import { useI18n } from '../i18n/useI18n';

const useStyles = makeStyles({
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: tokens.spacingHorizontalL,
    boxSizing: 'border-box',
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalXXL,
    boxSizing: 'border-box',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow8,
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
  language: { flexShrink: 0, minWidth: '104px' },
  subtle: { color: tokens.colorNeutralForeground3 },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
});

interface AuthScreenProps {
  readonly serviceName: string;
  readonly gate: AuthGate;
}

export function AuthScreen({ serviceName, gate }: AuthScreenProps) {
  const styles = useStyles();
  const { t, locale } = useI18n();
  const { setLocale } = usePreferences();
  const title = gate.phase === 'setup' ? t.setupTitle : t.signIn;
  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <Caption1 className={styles.subtle}>{serviceName}</Caption1>
            <Title3 as="h1" block>
              {title}
            </Title3>
          </div>
          <Select
            className={styles.language}
            size="small"
            aria-label={t.language}
            value={locale}
            onChange={(_, data) => {
              if (isLocale(data.value)) setLocale(data.value);
            }}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option} lang={option}>
                {LOCALE_ENDONYM[option]}
              </option>
            ))}
          </Select>
        </div>
        {gate.phase === 'loading' && <Spinner size="small" label={t.checkingSession} />}
        {gate.phase === 'unavailable' && <InlineError message={t.authUnavailable} onRetry={gate.retry} />}
        {gate.phase === 'setup' && <SetupForm gate={gate} />}
        {gate.phase === 'login' && <LoginForm gate={gate} />}
      </div>
    </main>
  );
}

function LoginForm({ gate }: { readonly gate: AuthGate }) {
  const styles = useStyles();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorKind | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(undefined);
    try {
      await gate.login(normalizeEmail(email), password);
    } catch (reason) {
      setError(errorKindOf(reason));
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      {gate.expired && !error && (
        <MessageBar intent="warning">
          <MessageBarBody>{t.sessionExpired}</MessageBarBody>
        </MessageBar>
      )}
      <Field label={t.email} required>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(_, data) => setEmail(data.value)}
          autoFocus
        />
      </Field>
      <Field label={t.password} required>
        <Input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(_, data) => setPassword(data.value)}
        />
      </Field>
      {error && <InlineError message={t.authError[error]} />}
      <Button type="submit" appearance="primary" disabled={busy || !email.trim() || !password}>
        {t.signIn}
      </Button>
    </form>
  );
}

function SetupForm({ gate }: { readonly gate: AuthGate }) {
  const styles = useStyles();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorKind | undefined>();
  const issues = userFormIssues(email, name);
  const weak = !isValidPassword(password);
  const mismatch = password !== confirm;
  const invalid = !isValidEmail(email) || Boolean(issues.name) || weak || mismatch;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    setBusy(true);
    setError(undefined);
    try {
      await gate.setup({ email: normalizeEmail(email), name: name.trim(), password });
    } catch (reason) {
      setError(errorKindOf(reason));
      setBusy(false);
    }
  };

  const invalidField = (show: boolean, message: string) =>
    touched && show ? { validationState: 'error' as const, validationMessage: message } : {};
  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <Body1>{t.setupDescription}</Body1>
      <Field label={t.email} required {...invalidField(Boolean(issues.email), t.emailRule)}>
        <Input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(_, data) => setEmail(data.value)}
          autoFocus
        />
      </Field>
      <Field label={t.userName} required {...invalidField(Boolean(issues.name), t.userNameRule(USER_NAME_MAX))}>
        <Input autoComplete="name" value={name} onChange={(_, data) => setName(data.value)} />
      </Field>
      <Field label={t.password} required {...invalidField(weak, t.passwordRule(PASSWORD_MIN))}>
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(_, data) => setPassword(data.value)}
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
      {error && <InlineError message={t.authError[error]} />}
      <Button type="submit" appearance="primary" disabled={busy}>
        {t.createAdmin}
      </Button>
    </form>
  );
}
