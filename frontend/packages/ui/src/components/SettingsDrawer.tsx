import {
  Button,
  Caption1,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  FluentProvider,
  OverlayDrawer,
  Radio,
  RadioGroup,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import {
  LOCALES,
  THEME_PREFERENCES,
  isLocale,
  isThemePreference,
  type ResolvedMode,
  type ThemePreference,
} from '@process-flow/domain';
import { usePreferences, useWorkflow } from '@process-flow/react';
import { LOCALE_ENDONYM } from '../i18n/messages';
import { useI18n } from '../i18n/useI18n';
import { darkTheme, lightTheme } from '../theme/brand';
import { InlineError } from './InlineError';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXL },
  note: { color: tokens.colorNeutralForeground3 },
  themeGroup: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: tokens.spacingHorizontalS },
  themeRadio: { margin: 0, minWidth: 0 },
  themeLabel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: tokens.spacingVerticalXS,
    textAlign: 'center',
    wordBreak: 'keep-all',
  },
  preview: {
    display: 'flex',
    width: '72px',
    height: '52px',
    flexShrink: 0,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
    outline: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
  },
  half: { flex: '1 1 0', minWidth: 0, overflow: 'hidden' },
  surface: {
    height: '100%',
    width: '100%',
    backgroundColor: tokens.colorNeutralBackground2,
    display: 'flex',
    flexDirection: 'column',
  },
  surfaceBar: {
    height: '12px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  surfaceCard: {
    margin: '6px',
    flexGrow: 1,
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    padding: '4px',
  },
  surfaceButton: {
    width: '24px',
    height: '8px',
    borderRadius: tokens.borderRadiusSmall,
    backgroundColor: tokens.colorBrandBackground,
  },
  secondary: { color: tokens.colorNeutralForeground3 },
});

function PreviewSurface({ mode }: { readonly mode: ResolvedMode }) {
  const styles = useStyles();
  return (
    <FluentProvider theme={mode === 'dark' ? darkTheme : lightTheme} className={styles.surface}>
      <div className={styles.surfaceBar} />
      <div className={styles.surfaceCard}>
        <div className={styles.surfaceButton} />
      </div>
    </FluentProvider>
  );
}

function ThemePreview({ preference }: { readonly preference: ThemePreference }) {
  const styles = useStyles();
  if (preference === 'system') {
    return (
      <span className={styles.preview} aria-hidden="true">
        <span className={styles.half}>
          <PreviewSurface mode="light" />
        </span>
        <span className={styles.half}>
          <PreviewSurface mode="dark" />
        </span>
      </span>
    );
  }
  return (
    <span className={styles.preview} aria-hidden="true">
      <PreviewSurface mode={preference} />
    </span>
  );
}

interface SettingsDrawerProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function SettingsDrawer({ open, onOpenChange }: SettingsDrawerProps) {
  const styles = useStyles();
  const { t, locale } = useI18n();
  const prefs = usePreferences();
  const { preferenceError, retryPreferences, preferencesLoadError, retryPreferenceLoad } = useWorkflow();

  return (
    <OverlayDrawer position="end" size="small" open={open} onOpenChange={(_, data) => onOpenChange(data.open)}>
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label={t.close}
              icon={<Dismiss24Regular />}
              onClick={() => onOpenChange(false)}
            />
          }
        >
          {t.settings}
        </DrawerHeaderTitle>
        <Caption1 className={styles.note}>{t.appliesImmediately}</Caption1>
      </DrawerHeader>
      <DrawerBody className={styles.body}>
        {preferenceError && <InlineError message={t.preferencesSaveFailed} onRetry={() => void retryPreferences?.()} />}
        {preferencesLoadError && (
          <InlineError message={t.preferencesLoadFailed} onRetry={() => void retryPreferenceLoad?.()} />
        )}
        <Field label={t.theme}>
          <RadioGroup
            className={styles.themeGroup}
            layout="horizontal-stacked"
            value={prefs.themePreference}
            onChange={(_, data) => {
              if (isThemePreference(data.value)) prefs.setThemePreference(data.value);
            }}
          >
            {THEME_PREFERENCES.map((preference) => (
              <Radio
                key={preference}
                className={styles.themeRadio}
                value={preference}
                label={
                  <span className={styles.themeLabel}>
                    <ThemePreview preference={preference} />
                    <span>{t.themeLabel[preference]}</span>
                    {preference === 'system' && (
                      <Caption1 className={styles.secondary}>{t.systemNow(prefs.systemMode)}</Caption1>
                    )}
                  </span>
                }
              />
            ))}
          </RadioGroup>
        </Field>

        <Field label={t.language}>
          <RadioGroup
            value={locale}
            onChange={(_, data) => {
              if (isLocale(data.value)) prefs.setLocale(data.value);
            }}
          >
            {LOCALES.map((option) => (
              <Radio
                key={option}
                value={option}
                label={
                  <span lang={option}>
                    {LOCALE_ENDONYM[option]}
                    {t.localeName[option] !== LOCALE_ENDONYM[option] && (
                      <span className={styles.secondary} lang={locale}>
                        {' · '}
                        {t.localeName[option]}
                      </span>
                    )}
                  </span>
                }
              />
            ))}
          </RadioGroup>
        </Field>
      </DrawerBody>
    </OverlayDrawer>
  );
}
