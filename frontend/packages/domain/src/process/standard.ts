import type { Locale } from '../locale';
import { defineProcess, type Process } from './model';
import type { ProcessText } from './text';

export const STANDARD_PROCESS_SPEC = {
  stages: [
    {
      id: 'planning',
      tasks: [
        'goals',
        'user-research',
        'user-modeling',
        'requirements',
        'information-architecture',
        'user-flows',
        'constraints',
      ],
    },
    {
      id: 'design',
      tasks: ['wireframes', 'prototyping', 'visual-design', 'design-system', 'technical-design', 'design-handoff'],
    },
    { id: 'development', tasks: ['dev-environment', 'implementation', 'unit-testing'] },
    { id: 'testing', tasks: ['integration-testing', 'non-functional-testing', 'acceptance-testing'] },
    { id: 'release', tasks: ['release-prep', 'deployment'] },
    { id: 'operations', tasks: ['monitoring', 'feedback-analysis', 'maintenance', 'iteration'] },
  ],
} as const;

export const STANDARD_PROCESS: Process = defineProcess(STANDARD_PROCESS_SPEC);

export type StandardStageId = (typeof STANDARD_PROCESS_SPEC.stages)[number]['id'];
export type StandardTaskId = (typeof STANDARD_PROCESS_SPEC.stages)[number]['tasks'][number];

export type StandardProcessText = ProcessText<StandardStageId, StandardTaskId>;

const ko: StandardProcessText = {
  stages: {
    planning: {
      name: '기획·분석',
      description: '무엇을, 누구를 위해, 왜 만드는지 정하고 화면 구조와 사용자 흐름까지 확정합니다.',
    },
    design: {
      name: '설계·디자인',
      description: '화면 구조를 시각화하고 사용자에게 검증한 뒤, 개발에 필요한 디자인과 기술 설계를 넘깁니다.',
    },
    development: {
      name: '개발',
      description: '개발 환경을 갖추고 기능 단위로 구현하며, 단위 테스트와 코드 리뷰로 품질을 확보합니다.',
    },
    testing: {
      name: '테스트·QA',
      description: '전체 시나리오와 비기능 품질을 검증하고, 발주자나 실사용자가 최종 인수합니다.',
    },
    release: {
      name: '배포·출시',
      description: '운영 환경과 롤백 계획을 준비하고, 위험을 줄이도록 단계적으로 배포합니다.',
    },
    operations: {
      name: '운영·유지보수',
      description: '서비스를 안정적으로 운영하고, 데이터와 피드백으로 다음 개선 과제를 정합니다.',
    },
  },
  tasks: {
    goals: {
      name: '목표와 문제 정의',
      output: '프로젝트 헌장, KPI 정의서',
      description: '해결할 문제와 비즈니스 목표, 성공 지표(KPI)를 정하고 이해관계자와 범위를 합의합니다.',
    },
    'user-research': {
      name: '사용자 리서치·경쟁 분석',
      output: '리서치 보고서',
      description: '인터뷰, 설문, 기존 데이터로 사용자의 니즈와 불편을 파악하고 경쟁 서비스를 분석합니다.',
    },
    'user-modeling': {
      name: '사용자 모델링',
      output: '페르소나, 사용자 여정 맵',
      description: '대표 사용자 유형과 사용 상황을 페르소나, 시나리오, 여정 맵으로 정리합니다.',
    },
    requirements: {
      name: '요구사항 정의',
      output: '요구사항 명세서, MVP 범위',
      description: '기능·비기능 요구사항과 유저 스토리를 쓰고, 우선순위를 매겨 MVP 범위를 확정합니다.',
    },
    'information-architecture': {
      name: '정보 구조(IA) 설계',
      output: '사이트맵',
      description: '콘텐츠를 목록으로 만들고, 사이트맵과 메뉴 구조로 화면 목록과 계층을 정합니다.',
    },
    'user-flows': {
      name: '사용자 흐름 설계',
      output: '유저 플로우',
      description: '핵심 작업이 거치는 화면 순서를 그리고, 오류·빈 상태·예외 경로도 함께 정합니다.',
    },
    constraints: {
      name: '제약 조건 확인',
      output: '제약 조건 목록',
      description: '플랫폼, 기술, 일정, 예산, 법·규제, 기존 시스템 연동 조건을 확인합니다.',
    },
    wireframes: {
      name: '와이어프레임',
      output: '와이어프레임',
      description: '화면별 레이아웃, 요소 배치, 화면 간 연결을 그립니다. 저충실도로 시작해 점점 정교하게 만듭니다.',
    },
    prototyping: {
      name: '프로토타입·사용성 테스트',
      output: '프로토타입, 테스트 결과',
      description: '클릭해 볼 수 있는 프로토타입을 실제 사용자에게 써 보게 하고, 흐름과 구조를 검증해 고칩니다.',
    },
    'visual-design': {
      name: 'UI 비주얼 디자인',
      output: 'UI 시안',
      description: '색상, 타이포그래피, 아이콘, 이미지를 정하고 고충실도 시안을 만듭니다.',
    },
    'design-system': {
      name: '디자인 시스템 구축',
      output: '디자인 토큰, 공통 컴포넌트',
      description: '디자인 토큰과 버튼·폼·모달 같은 공통 컴포넌트, 각 컴포넌트의 상태를 정의합니다.',
    },
    'technical-design': {
      name: '기술 설계',
      output: '아키텍처 문서, ERD, API 명세',
      description: '시스템 아키텍처, 기술 스택, DB 모델, API, 보안을 설계합니다.',
    },
    'design-handoff': {
      name: '디자인 핸드오프',
      output: '화면 명세서',
      description: '간격, 반응형 기준점, 인터랙션, 엣지 케이스를 담은 화면 명세를 개발자에게 넘깁니다.',
    },
    'dev-environment': {
      name: '개발 환경 구축',
      output: '저장소, CI/CD 파이프라인',
      description: '저장소, 브랜치 전략, 코딩 규칙, CI/CD, 개발·스테이징·운영 환경을 갖춥니다.',
    },
    implementation: {
      name: '구현',
      output: '소스 코드',
      description: '프론트엔드, 백엔드, API 연동을 스프린트 단위로 기능별로 개발합니다.',
    },
    'unit-testing': {
      name: '단위 테스트·코드 리뷰',
      output: '테스트 코드, 리뷰 기록',
      description: '기능마다 테스트를 작성하고, 동료 리뷰로 품질을 확인합니다.',
    },
    'integration-testing': {
      name: '통합·시스템 테스트',
      output: '테스트 결과서',
      description: '모듈 간 연동과 전체 사용자 시나리오(E2E)를 검증합니다.',
    },
    'non-functional-testing': {
      name: '비기능 테스트',
      output: '성능·보안·접근성 점검 보고서',
      description: '성능·부하, 보안 취약점, 접근성, 기기·브라우저 호환성을 점검합니다.',
    },
    'acceptance-testing': {
      name: '인수 테스트(UAT)',
      output: '인수 확인서',
      description: '발주자나 실사용자가 요구사항대로 동작하는지 최종 확인합니다.',
    },
    'release-prep': {
      name: '출시 준비',
      output: '배포 계획서, 롤백 계획',
      description: '운영 인프라, 모니터링·로그, 백업과 롤백 계획을 준비합니다. 앱이라면 스토어 심사도 받습니다.',
    },
    deployment: {
      name: '배포',
      output: '릴리스 노트',
      description: '카나리, 베타 같은 단계적 배포로 위험을 줄이고, 사용자 안내와 고객 지원을 준비합니다.',
    },
    monitoring: {
      name: '운영·모니터링',
      output: '모니터링 대시보드, 장애 보고서',
      description: '장애를 감지하고 대응하며, 성능과 보안 패치를 관리합니다.',
    },
    'feedback-analysis': {
      name: '데이터 분석·피드백 수집',
      output: '분석 리포트',
      description: 'KPI를 측정하고 사용자 행동, 문의, 리뷰를 분석합니다.',
    },
    maintenance: {
      name: '유지보수',
      output: '변경 이력',
      description: '버그 수정, 환경 변화 대응, 기능 개선, 리팩터링을 진행합니다.',
    },
    iteration: {
      name: '개선 반복',
      output: '개선 백로그',
      description: '분석 결과로 다음 개선 과제를 정하고 1단계로 돌아갑니다.',
    },
  },
};

const en: StandardProcessText = {
  stages: {
    planning: {
      name: 'Planning & analysis',
      description: 'Decide what to build, for whom, and why, then settle the screen structure and user flows.',
    },
    design: {
      name: 'Design',
      description:
        'Visualize the screen structure, validate it with users, and hand off design and technical design for development.',
    },
    development: {
      name: 'Development',
      description:
        'Set up the development environment, build feature by feature, and ensure quality with unit tests and code review.',
    },
    testing: {
      name: 'Testing & QA',
      description:
        'Verify end-to-end scenarios and non-functional quality, then have the client or real users accept the result.',
    },
    release: {
      name: 'Release',
      description: 'Prepare the production environment and a rollback plan, and roll out gradually to reduce risk.',
    },
    operations: {
      name: 'Operations & maintenance',
      description: 'Run the service reliably and use data and feedback to choose the next improvements.',
    },
  },
  tasks: {
    goals: {
      name: 'Define goals and problems',
      output: 'Project charter, KPI definitions',
      description:
        'Set the problem to solve, the business goals, and success metrics (KPIs), and agree on scope with stakeholders.',
    },
    'user-research': {
      name: 'User research & competitive analysis',
      output: 'Research report',
      description:
        'Use interviews, surveys, and existing data to understand user needs and pain points, and analyze competing services.',
    },
    'user-modeling': {
      name: 'User modeling',
      output: 'Personas, user journey maps',
      description: 'Capture representative user types and contexts as personas, scenarios, and journey maps.',
    },
    requirements: {
      name: 'Requirements definition',
      output: 'Requirements specification, MVP scope',
      description:
        'Write functional and non-functional requirements and user stories, prioritize them, and settle the MVP scope.',
    },
    'information-architecture': {
      name: 'Information architecture (IA)',
      output: 'Sitemap',
      description: 'Inventory the content and define the screen list and hierarchy with a sitemap and menu structure.',
    },
    'user-flows': {
      name: 'User flow design',
      output: 'User flows',
      description: 'Map the screens each key task passes through, including error, empty, and exception paths.',
    },
    constraints: {
      name: 'Constraint check',
      output: 'Constraint list',
      description:
        'Confirm platform, technology, schedule, budget, legal and regulatory, and legacy integration constraints.',
    },
    wireframes: {
      name: 'Wireframes',
      output: 'Wireframes',
      description:
        'Draw each screen’s layout, element placement, and connections between screens. Start low-fidelity and refine.',
    },
    prototyping: {
      name: 'Prototype & usability testing',
      output: 'Prototype, test results',
      description: 'Have real users try a clickable prototype, then validate and fix the flow and structure.',
    },
    'visual-design': {
      name: 'UI visual design',
      output: 'UI mockups',
      description: 'Choose color, typography, icons, and imagery, and produce high-fidelity mockups.',
    },
    'design-system': {
      name: 'Design system',
      output: 'Design tokens, shared components',
      description:
        'Define design tokens, shared components such as buttons, forms, and modals, and each component’s states.',
    },
    'technical-design': {
      name: 'Technical design',
      output: 'Architecture document, ERD, API specification',
      description: 'Design the system architecture, tech stack, data model, APIs, and security.',
    },
    'design-handoff': {
      name: 'Design handoff',
      output: 'Screen specification',
      description:
        'Hand developers a screen specification covering spacing, responsive breakpoints, interactions, and edge cases.',
    },
    'dev-environment': {
      name: 'Development environment',
      output: 'Repository, CI/CD pipeline',
      description:
        'Set up the repository, branching strategy, coding conventions, CI/CD, and development, staging, and production environments.',
    },
    implementation: {
      name: 'Implementation',
      output: 'Source code',
      description: 'Build the frontend, backend, and API integrations feature by feature in sprints.',
    },
    'unit-testing': {
      name: 'Unit testing & code review',
      output: 'Test code, review records',
      description: 'Write tests for each feature and check quality through peer review.',
    },
    'integration-testing': {
      name: 'Integration & system testing',
      output: 'Test report',
      description: 'Verify integration between modules and complete end-to-end user scenarios.',
    },
    'non-functional-testing': {
      name: 'Non-functional testing',
      output: 'Performance, security, and accessibility report',
      description:
        'Check performance and load, security vulnerabilities, accessibility, and device and browser compatibility.',
    },
    'acceptance-testing': {
      name: 'User acceptance testing (UAT)',
      output: 'Acceptance sign-off',
      description: 'The client or real users confirm that everything works as required.',
    },
    'release-prep': {
      name: 'Release preparation',
      output: 'Deployment plan, rollback plan',
      description:
        'Prepare production infrastructure, monitoring and logging, backups, and a rollback plan. Apps also go through store review.',
    },
    deployment: {
      name: 'Deployment',
      output: 'Release notes',
      description:
        'Reduce risk with staged rollouts such as canary and beta releases, and prepare user communication and support.',
    },
    monitoring: {
      name: 'Operations & monitoring',
      output: 'Monitoring dashboard, incident reports',
      description: 'Detect and respond to incidents, and manage performance and security patches.',
    },
    'feedback-analysis': {
      name: 'Data analysis & feedback',
      output: 'Analysis report',
      description: 'Measure KPIs and analyze user behavior, inquiries, and reviews.',
    },
    maintenance: {
      name: 'Maintenance',
      output: 'Change log',
      description: 'Fix bugs, adapt to environment changes, improve features, and refactor.',
    },
    iteration: {
      name: 'Iterate on improvements',
      output: 'Improvement backlog',
      description: 'Use the analysis to choose the next improvements and return to stage 1.',
    },
  },
};

export const STANDARD_PROCESS_TEXT: Readonly<Record<Locale, StandardProcessText>> = { ko, en };
