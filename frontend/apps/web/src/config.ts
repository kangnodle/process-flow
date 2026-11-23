export interface AppConfig {
  readonly serviceName: string;
  readonly projectName: string | undefined;
  readonly demo: boolean;
}

export interface RawEnv {
  readonly VITE_SERVICE_NAME?: string;
  readonly VITE_PROJECT_NAME?: string;
  readonly VITE_DEMO?: string;
}

export const DEFAULT_SERVICE_NAME = 'Process Flow';

const nonEmpty = (value: string | undefined): string | undefined => (value?.trim() ? value : undefined);

export function parseConfig(env: RawEnv): AppConfig {
  return {
    serviceName: nonEmpty(env.VITE_SERVICE_NAME) ?? DEFAULT_SERVICE_NAME,
    projectName: nonEmpty(env.VITE_PROJECT_NAME),
    demo: env.VITE_DEMO === 'true',
  };
}
