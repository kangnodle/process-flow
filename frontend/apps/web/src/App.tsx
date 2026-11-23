import { FluentProvider, useFocusFinders } from '@fluentui/react-components';
import {
  STANDARD_PROCESS,
  STANDARD_PROCESS_TEXT,
  type Locale,
  type Process,
  type StoredPreferences,
  type WorkflowState,
} from '@process-flow/domain';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AuthProvider,
  EvidenceFilesContext,
  NavigationProvider,
  PreferencesProvider,
  ProjectsProvider,
  usePreferences,
  useWorkflowSelector,
  shallowEqual,
  WorkflowProvider,
} from '@process-flow/react';
import type { DocumentSurface, Platform, WorkflowFocus } from '@process-flow/application';
import { DEFAULT_SERVICE_NAME, type AppConfig } from './config';
import { AppShell, AuthScreen, type ProcessTextCatalog, ProcessTextContext, themeFor, useI18n } from '@process-flow/ui';

export interface AppProps {
  readonly platform: Platform;
  readonly config?: Pick<AppConfig, 'serviceName' | 'projectName'>;
  readonly process?: Process;
  readonly processText?: ProcessTextCatalog;
  readonly initialState?: WorkflowState;
  readonly initialPreferences?: Partial<StoredPreferences>;
}

export function App({
  platform,
  config,
  process = STANDARD_PROCESS,
  processText = STANDARD_PROCESS_TEXT,
  initialState,
  initialPreferences,
}: AppProps) {
  useFocusFinders();
  const serviceName = config?.serviceName ?? DEFAULT_SERVICE_NAME;
  const repository = platform.workflowRepository;
  const [opened, setOpened] = useState<{ generation: number; focus?: WorkflowFocus }>({ generation: 0 });
  const switchWorkflow = useCallback(
    (workflowId: string | undefined, focus?: WorkflowFocus) => {
      repository?.switchTo?.(workflowId);
      setOpened((value) => ({ generation: value.generation + 1, ...(focus ? { focus } : {}) }));
    },
    [repository],
  );
  const [gateLocale, setGateLocale] = useState<Locale>();
  const preferredLanguages = useMemo(
    () => (gateLocale ? [gateLocale, ...platform.preferredLanguages] : platform.preferredLanguages),
    [gateLocale, platform.preferredLanguages],
  );
  const rememberGateLocale = useCallback((patch: Partial<StoredPreferences>) => {
    if (patch.locale) setGateLocale(patch.locale);
  }, []);
  const workspace = (
    <EvidenceFilesContext.Provider value={platform.evidenceFiles}>
      <NavigationProvider {...(platform.navigation ? { navigation: platform.navigation } : {})}>
        <WorkflowProvider
          key={opened.generation}
          {...(opened.focus ? { initialFocus: opened.focus } : {})}
          {...(platform.guardUnsaved ? { guardUnsaved: platform.guardUnsaved } : {})}
          {...(platform.workflowRepository ? { repository: platform.workflowRepository } : {})}
          scheduler={platform.scheduler}
          process={process}
          {...(initialState ? { initialState } : {})}
        >
          <ProjectsProvider
            {...(repository?.switchTo && platform.projectRepository ? { repository: platform.projectRepository } : {})}
            {...(platform.userRepository ? { users: platform.userRepository } : {})}
            {...(platform.workRepository ? { work: platform.workRepository } : {})}
            switchWorkflow={switchWorkflow}
          >
            <WorkspacePreferences
              platform={platform}
              preferredLanguages={preferredLanguages}
              initial={initialPreferences}
            >
              <ProcessTextContext.Provider value={processText}>
                <Themed surface={platform.document} serviceName={serviceName}>
                  <ShellWithNames
                    serviceName={serviceName}
                    projectName={config?.projectName}
                    compactTaskLayout={platform.compactTaskLayout}
                  />
                </Themed>
              </ProcessTextContext.Provider>
            </WorkspacePreferences>
          </ProjectsProvider>
        </WorkflowProvider>
      </NavigationProvider>
    </EvidenceFilesContext.Provider>
  );
  if (!platform.authRepository) return workspace;
  return (
    <AuthProvider
      repository={platform.authRepository}
      renderGate={(gate) => (
        <PreferencesProvider
          colorScheme={platform.colorScheme}
          preferredLanguages={preferredLanguages}
          {...(initialPreferences ? { initial: initialPreferences } : {})}
          onChange={rememberGateLocale}
        >
          <ProcessTextContext.Provider value={processText}>
            <Themed surface={platform.document} serviceName={serviceName}>
              <AuthScreen serviceName={serviceName} gate={gate} />
            </Themed>
          </ProcessTextContext.Provider>
        </PreferencesProvider>
      )}
    >
      {workspace}
    </AuthProvider>
  );
}

function WorkspacePreferences({
  platform,
  preferredLanguages,
  initial,
  children,
}: {
  readonly platform: Platform;
  readonly preferredLanguages: readonly string[];
  readonly initial: Partial<StoredPreferences> | undefined;
  readonly children: ReactNode;
}) {
  const { remotePreferences, savePreferences } = useWorkflowSelector(
    ({ remotePreferences, savePreferences }) => ({ remotePreferences, savePreferences }),
    shallowEqual,
  );
  return (
    <PreferencesProvider
      colorScheme={platform.colorScheme}
      preferredLanguages={preferredLanguages}
      {...(initial ? { initial } : {})}
      {...(remotePreferences ? { remote: remotePreferences } : {})}
      {...(savePreferences ? { onChange: savePreferences } : {})}
    >
      {children}
    </PreferencesProvider>
  );
}

function Themed({
  surface,
  serviceName,
  children,
}: {
  readonly surface: DocumentSurface;
  readonly serviceName: string;
  readonly children: ReactNode;
}) {
  const { resolvedMode } = usePreferences();
  const { locale, t } = useI18n();

  useEffect(() => {
    surface.setLanguage(locale);
    surface.setTitle(`${t.documentTitle} · ${serviceName}`);
  }, [surface, locale, t, serviceName]);

  return <FluentProvider theme={themeFor(resolvedMode)}>{children}</FluentProvider>;
}

function ShellWithNames({
  serviceName,
  projectName,
  compactTaskLayout,
}: {
  readonly serviceName: string;
  readonly projectName: string | undefined;
  readonly compactTaskLayout: Platform['compactTaskLayout'];
}) {
  const { t } = useI18n();
  return (
    <AppShell
      serviceName={serviceName}
      projectName={projectName ?? t.projectNamePlaceholder}
      {...(compactTaskLayout && { compactTaskLayout })}
    />
  );
}
