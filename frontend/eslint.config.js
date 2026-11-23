import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const BROWSER_SIDE_EFFECT_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'matchMedia',
  'history',
  'location',
].map((name) => ({
  name,
  message: `${name}에 직접 접근하지 말고 포트(@process-flow/application)를 거치세요. 구현은 @process-flow/adapter-browser에 둡니다.`,
}));
const IMPURE_GLOBALS = [
  'fetch',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'console',
  'process',
].map((name) => ({
  name,
  message: `${name}는 부수효과입니다. 포트로 받고, 구현은 어댑터 패키지에 두세요.`,
}));

const NO_HEX_COLOR = {
  selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
  message:
    '색상 값을 하드코딩하지 말고 Fluent 토큰(tokens.*)을 사용하세요. 브랜드 램프는 packages/ui/src/theme/brand.ts에만 둡니다.',
};
const NO_IMPORT_META_ENV = {
  selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
  message: '환경 변수는 apps/web/src/main.tsx에서만 읽고 config.ts의 AppConfig로 넘기세요.',
};
const PURE_SYNTAX = [
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: '현재 시각은 인자로 받으세요.' },
];
const PURE_PROPERTIES = [
  'error',
  { object: 'Math', property: 'random', message: '난수는 인자로 받으세요.' },
  { object: 'Date', property: 'now', message: '현재 시각은 인자로 받으세요.' },
];

const restrict = (...patterns) => ['error', { patterns }];
const NO_INTERNALS = {
  group: ['@process-flow/*/*'],
  message: '다른 패키지는 공개 진입점(@process-flow/<패키지>)으로만 가져오세요.',
};
const NO_NODE = {
  regex: '^(node:)?(fs|path|os|http|https|child_process|crypto)(/|$)',
  message: 'Node API는 쓰지 않습니다.',
};
const only = (...allowed) =>
  allowed.length === 0
    ? { group: ['@process-flow/*'], message: '도메인은 다른 패키지에 의존하지 않습니다.' }
    : {
        regex: `^@process-flow/(?!(${allowed.join('|')})$)`,
        message: `이 계층은 ${allowed.map((name) => `@process-flow/${name}`).join(', ')}에만 의존합니다(의존은 안쪽으로만).`,
      };
const NO_DOMAIN_EXTERNAL = {
  regex: '^[^.]',
  message: '도메인은 외부 라이브러리를 가져오지 않습니다.',
};
const NO_APPLICATION_EXTERNAL = {
  regex: '^(?!@process-flow/domain$)[^.]',
  message: '애플리케이션은 도메인과 로컬 모듈만 가져옵니다.',
};
const NO_REACT = {
  group: ['react', 'react-dom', 'react/*', 'react-dom/*'],
  message: '이 계층은 React 없이 순수해야 합니다.',
};
const NO_FLUENT = { group: ['@fluentui/*'], message: 'Fluent UI는 화면(@process-flow/ui)에서만 씁니다.' };

const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));
const packageOf = (filename) =>
  relative(workspaceRoot, filename)
    .split(sep)
    .join('/')
    .match(/^(packages|apps)\/[^/]+(?=\/|$)/)?.[0];

const workspaceBoundaries = {
  rules: {
    'ui-use-cases': {
      meta: { messages: { repository: '화면은 저장소 대신 application 유스케이스를 사용하세요.' } },
      create(context) {
        const repositoryName = (name) => typeof name === 'string' && /(?:repository|repositories)$/i.test(name);
        return {
          ImportSpecifier(node) {
            if (repositoryName(node.imported.name ?? node.imported.value)) {
              context.report({ node, messageId: 'repository' });
            }
          },
          MemberExpression(node) {
            if (repositoryName(node.computed ? node.property.value : node.property.name)) {
              context.report({ node, messageId: 'repository' });
            }
          },
          CallExpression(node) {
            if (
              node.callee.type === 'MemberExpression' &&
              node.callee.object.type === 'Identifier' &&
              repositoryName(node.callee.object.name)
            ) {
              context.report({ node, messageId: 'repository' });
            }
          },
        };
      },
    },
    'public-entrypoint': {
      meta: { messages: { crossPackage: '다른 워크스페이스는 공개 패키지 이름으로 가져오세요.' } },
      create(context) {
        const sourcePackage = packageOf(context.filename);
        function check(node) {
          const specifier = node?.value;
          if (!sourcePackage || typeof specifier !== 'string' || !specifier.startsWith('.')) return;
          const targetPackage = packageOf(resolve(dirname(context.filename), specifier));
          if (targetPackage !== sourcePackage) context.report({ node, messageId: 'crossPackage' });
        }
        return {
          ImportDeclaration: (node) => check(node.source),
          ExportNamedDeclaration: (node) => check(node.source),
          ExportAllDeclaration: (node) => check(node.source),
          ImportExpression: (node) => check(node.source),
          TSImportType: (node) => check(node.source),
        };
      },
    },
  },
};

const sources = (pkg) => [`packages/${pkg}/src/**/*.{ts,tsx}`];

export default tseslint.config(
  { ignores: ['**/dist', '**/node_modules', '**/coverage'] },
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022 },
  },
  {
    files: ['*.{ts,js}', 'packages/*/vitest.config.ts', 'apps/*/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['{apps,packages}/*/src/**/*.{ts,tsx}'],
    plugins: { workspace: workspaceBoundaries },
    rules: { 'workspace/public-entrypoint': 'error' },
  },

  {
    files: sources('domain'),
    rules: {
      'no-restricted-imports': restrict(NO_REACT, NO_FLUENT, NO_NODE, NO_DOMAIN_EXTERNAL, only()),
      'no-restricted-globals': ['error', ...BROWSER_SIDE_EFFECT_GLOBALS, ...IMPURE_GLOBALS],
      'no-restricted-properties': PURE_PROPERTIES,
      'no-restricted-syntax': ['error', ...PURE_SYNTAX],
    },
  },
  {
    files: sources('application'),
    rules: {
      'no-restricted-imports': restrict(
        NO_REACT,
        NO_FLUENT,
        NO_NODE,
        NO_INTERNALS,
        NO_APPLICATION_EXTERNAL,
        only('domain'),
      ),
      'no-restricted-globals': ['error', ...BROWSER_SIDE_EFFECT_GLOBALS, ...IMPURE_GLOBALS],
      'no-restricted-properties': PURE_PROPERTIES,
      'no-restricted-syntax': ['error', ...PURE_SYNTAX],
    },
  },

  {
    files: sources('runtime'),
    rules: {
      'no-restricted-imports': restrict(NO_REACT, NO_FLUENT, NO_NODE, NO_INTERNALS, only('domain', 'application')),
      'no-restricted-globals': ['error', ...BROWSER_SIDE_EFFECT_GLOBALS, ...IMPURE_GLOBALS],
      'no-restricted-properties': PURE_PROPERTIES,
      'no-restricted-syntax': ['error', ...PURE_SYNTAX, NO_IMPORT_META_ENV],
    },
  },

  {
    files: sources('adapter-http'),
    rules: {
      'no-restricted-imports': restrict(NO_REACT, NO_FLUENT, NO_NODE, NO_INTERNALS, only('domain', 'application')),
      'no-restricted-globals': ['error', ...BROWSER_SIDE_EFFECT_GLOBALS],
    },
  },
  {
    files: sources('adapter-browser'),
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': restrict(NO_REACT, NO_FLUENT, NO_NODE, NO_INTERNALS, only('domain', 'application')),
    },
  },

  {
    files: [...sources('react'), ...sources('ui'), 'apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: sources('react'),
    rules: {
      'no-restricted-imports': restrict(NO_FLUENT, NO_NODE, NO_INTERNALS, only('domain', 'application', 'runtime')),
      'no-restricted-globals': ['error', ...BROWSER_SIDE_EFFECT_GLOBALS, ...IMPURE_GLOBALS],
      'no-restricted-syntax': ['error', NO_IMPORT_META_ENV],
    },
  },
  {
    files: sources('ui'),
    rules: {
      'workspace/ui-use-cases': 'error',
      'no-restricted-imports': restrict(NO_NODE, NO_INTERNALS, only('domain', 'application', 'react')),
      'no-restricted-globals': ['error', ...BROWSER_SIDE_EFFECT_GLOBALS],
      'no-restricted-syntax': ['error', NO_HEX_COLOR, NO_IMPORT_META_ENV],
    },
  },
  {
    files: ['packages/ui/src/theme/brand.ts'],
    rules: { 'no-restricted-syntax': ['error', NO_IMPORT_META_ENV] },
  },

  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': restrict(NO_INTERNALS),
      'no-restricted-syntax': ['error', NO_HEX_COLOR, NO_IMPORT_META_ENV],
    },
  },
  {
    files: ['apps/web/src/App.tsx', 'apps/web/src/config.ts'],
    rules: {
      'no-restricted-imports': restrict(NO_INTERNALS, {
        group: ['@process-flow/adapter-*'],
        message: '어댑터는 main.tsx만 가져옵니다. App은 포트(Platform)에 의존하세요.',
      }),
      'no-restricted-globals': ['error', ...BROWSER_SIDE_EFFECT_GLOBALS],
    },
  },
  {
    files: ['apps/web/src/main.tsx'],
    rules: { 'no-restricted-syntax': ['error', NO_HEX_COLOR] },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'apps/web/src/test/**'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-imports': restrict(NO_INTERNALS) },
  },
);
