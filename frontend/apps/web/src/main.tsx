import { STANDARD_PROCESS, createDemoState, createInitialState } from '@process-flow/domain';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createAuthClient,
  createProjectRepository,
  createUserRepository,
  createWorkflowRepository,
  createWorkRepository,
} from '@process-flow/adapter-http';
import { createBrowserPlatform, createWorkflowIdentity } from '@process-flow/adapter-browser';
import { App } from './App';
import { parseConfig } from './config';
import './global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 요소를 찾을 수 없습니다. index.html을 확인하세요.');
}

const config = parseConfig(import.meta.env);
const initialState = config.demo ? createDemoState(STANDARD_PROCESS) : createInitialState(STANDARD_PROCESS);
const auth = createAuthClient(fetch, '/api/v1');

createRoot(container).render(
  <StrictMode>
    <App
      platform={{
        ...createBrowserPlatform(),
        ...(!config.demo
          ? {
              authRepository: auth.authRepository,
              workflowRepository: createWorkflowRepository(
                createWorkflowIdentity(),
                auth.request,
                '/api/v1',
                auth.sessionGeneration,
              ),
              projectRepository: createProjectRepository(auth.request, '/api/v1'),
              userRepository: createUserRepository(auth.request, '/api/v1'),
              workRepository: createWorkRepository(auth.request, '/api/v1'),
            }
          : {}),
      }}
      config={config}
      process={STANDARD_PROCESS}
      initialState={initialState}
    />
  </StrictMode>,
);
