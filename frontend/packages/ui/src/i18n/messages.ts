import type { Locale, ResolvedMode, Role, ThemePreference, ViewMode, WorkGroup } from '@process-flow/domain';
import type { RequestErrorKind } from '@process-flow/application';

export interface Messages {
  readonly documentTitle: string;

  readonly statusLocked: string;
  readonly statusDone: string;
  readonly statusDoing: string;
  readonly statusTodo: string;
  readonly statusAwaitingApproval: string;
  readonly statusRedoing: string;
  readonly statusRedoTodo: string;
  readonly statusLockedRework: string;

  readonly requestRework: string;
  readonly reworkDialogBody: (from: number, through: number, count: number) => string;
  readonly reworkRevokes: (stages: string) => string;
  readonly reworkReason: string;
  readonly reworkReasonPlaceholder: string;
  readonly reworkConfirm: string;
  readonly cancel: string;
  readonly reworkBannerTitle: string;
  readonly reworkBannerBody: (from: number, through: number, reason: string) => string;
  readonly stage: (n: number) => string;
  readonly stageWithName: (n: number, name: string) => string;
  readonly task: (n: number) => string;
  readonly unlocksAfter: (prevStage: number) => string;
  readonly taskStartsAfter: (prevStage: number) => string;
  readonly close: string;
  readonly openInTaskView: string;
  readonly markDone: string;
  readonly undoDone: string;
  readonly reopenRevokesApproval: (stage: number) => string;
  readonly waitForPrevious: (n: number, name: string) => string;
  readonly onlyLastReopenable: (n: number, name: string) => string;
  readonly inheritedOutput: string;
  readonly thisOutput: string;
  readonly approveStage: string;
  readonly restartCycle: string;

  readonly projectNamePlaceholder: string;
  readonly overallProgress: (done: number, total: number) => string;
  readonly overallProgressLabel: string;
  readonly projectLabel: string;
  readonly viewsLabel: string;
  readonly views: Record<ViewMode, string>;
  readonly serviceNavLabel: string;
  readonly home: string;
  readonly back: string;
  readonly breadcrumb: string;
  readonly stageOpenedTitle: (n: number, name: string) => string;
  readonly stageOpenedBody: (count: number) => string;

  readonly settings: string;
  readonly appliesImmediately: string;
  readonly theme: string;
  readonly themeLabel: Record<ThemePreference, string>;
  readonly systemNow: (mode: ResolvedMode) => string;
  readonly language: string;
  readonly localeName: Record<Locale, string>;

  readonly projects: string;
  readonly projectsDescription: string;
  readonly allProjects: string;
  readonly newProject: string;
  readonly showArchived: string;
  readonly projectName: string;
  readonly projectDescription: string;
  readonly projectNameRule: (max: number) => string;
  readonly projectDescriptionRule: (max: number) => string;
  readonly create: string;
  readonly save: string;
  readonly edit: string;
  readonly retry: string;
  readonly loading: string;
  readonly badgeCurrent: string;
  readonly badgeArchived: string;
  readonly noProjects: string;
  readonly noActiveProjects: string;
  readonly archiveProject: string;
  readonly unarchiveProject: string;
  readonly deleteProject: string;
  readonly deleteProjectWarning: string;
  readonly archivedNotice: string;
  readonly workflows: string;
  readonly noWorkflows: string;
  readonly newWorkflow: string;
  readonly workflowName: string;
  readonly workflowNamePlaceholder: string;
  readonly workflowNameHint: string;
  readonly workflowExplainer: (stages: number, tasks: number) => string;
  readonly startWorkflow: string;
  readonly openWorkflow: (name: string) => string;
  readonly openedWorkflow: string;
  readonly unsavedBlocksSwitch: string;
  readonly workflowMissing: string;
  readonly workflowOpenFailed: string;
  readonly openProjectsPanel: string;
  readonly projectSummary: string;
  readonly noWorkflowEyebrow: string;
  readonly noWorkflowTitle: string;
  readonly noWorkflowBody: string;
  readonly projectError: Record<RequestErrorKind, string>;

  readonly signIn: string;
  readonly signOut: string;
  readonly signOutFailed: string;
  readonly preferencesSaveFailed: string;
  readonly preferencesLoadFailed: string;
  readonly password: string;
  readonly passwordRule: (min: number) => string;
  readonly passwordConfirm: string;
  readonly passwordMismatch: string;
  readonly setupTitle: string;
  readonly setupDescription: string;
  readonly createAdmin: string;
  readonly checkingSession: string;
  readonly sessionExpired: string;
  readonly authUnavailable: string;
  readonly authError: Record<RequestErrorKind, string>;
  readonly accountMenu: (name: string) => string;
  readonly systemAdmin: string;
  readonly changePassword: string;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly wrongCurrentPassword: string;
  readonly passwordChanged: string;

  readonly users: string;
  readonly usersDescription: string;
  readonly allUsers: string;
  readonly newUser: string;
  readonly showInactive: string;
  readonly email: string;
  readonly userName: string;
  readonly emailRule: string;
  readonly userNameRule: (max: number) => string;
  readonly noUsers: string;
  readonly badgeInactive: string;
  readonly editUser: (name: string) => string;
  readonly deactivateUser: (name: string) => string;
  readonly reactivateUser: (name: string) => string;
  readonly deactivate: string;
  readonly reactivate: string;
  readonly duplicateEmail: string;
  readonly badgeAdmin: string;
  readonly adminSwitch: string;
  readonly initialPassword: string;
  readonly initialPasswordHint: string;
  readonly resetPassword: string;
  readonly resetPasswordHint: string;
  readonly currentProjectLoadFailed: string;
  readonly memberLoadFailed: string;
  readonly userPasswordPartiallySaved: string;
  readonly lastAdmin: string;
  readonly adminOnly: string;

  readonly members: string;
  readonly noMembers: string;
  readonly addMember: string;
  readonly memberUser: string;
  readonly memberRole: string;
  readonly chooseUser: string;
  readonly roleLabel: Record<Role, string>;
  readonly roleFor: (name: string) => string;
  readonly removeMember: (name: string) => string;
  readonly remove: string;
  readonly noUsersToAdd: string;
  readonly lastOwner: string;
  readonly inactiveCannotJoin: string;
  readonly rolesExplained: string;
  readonly membersOwnerOnly: string;
  readonly yourRole: (role: string) => string;
  readonly readOnlyNotice: string;
  readonly readOnlyReason: string;
  readonly permissionLost: string;
  readonly permissionLostOnArchive: string;

  readonly myWork: string;
  readonly myWorkDescription: string;
  readonly myWorkCount: (n: number) => string;
  readonly workGroup: Record<WorkGroup, string>;
  readonly workGroupHint: Record<WorkGroup, string>;
  readonly workNothing: string;
  readonly workNothingReady: string;
  readonly workLoadFailed: string;
  readonly workWhere: (project: string, workflow: string) => string;
  readonly workTask: (number: number, name: string) => string;
  readonly workApproval: (stageNumber: number, stage: string) => string;
  readonly workWatch: (kind: 'consulted' | 'informed', stageNumber: number, stage: string) => string;
  readonly workWaitTasks: (remaining: number) => string;
  readonly workWaitStageTasks: (remaining: number) => string;
  readonly workWaitLocked: (stageNumber: number) => string;
  readonly workRework: string;
  readonly openWorkItem: (label: string) => string;

  readonly assignments: string;
  readonly assignmentsDescription: string;
  readonly assignmentStage: string;
  readonly assignmentStageSummary: (accountable: string | undefined, responsible: number) => string;
  readonly raciMember: string;
  readonly raciColumn: Record<'accountable' | 'responsible' | 'consulted' | 'informed', string>;
  readonly raciCell: (kind: 'accountable' | 'responsible' | 'consulted' | 'informed', member: string) => string;
  readonly noAccountable: string;
  readonly stageRaciTable: (stage: string) => string;
  readonly taskResponsible: string;
  readonly taskResponsibleHint: string;
  readonly taskResponsibleCell: (task: string, member: string) => string;
  readonly viewerCannotExecute: string;
  readonly assignmentsNeedMembers: string;
  readonly assignmentsOwnerOnly: string;
  readonly assignmentsSaved: string;
  readonly assignmentsChangedElsewhere: string;
  readonly responsibleLabel: (names: string) => string;
  readonly accountableLabel: (name: string) => string;
  readonly unassigned: string;
  readonly unknownUser: string;
  readonly onlyResponsible: (names: string) => string;
  readonly onlyAccountable: (name: string) => string;
  readonly overrideTitle: string;
  readonly overrideBody: (names: string) => string;
  readonly overrideConfirm: string;

  readonly stepperLabel: string;
  readonly stepTasks: (done: number, total: number) => string;

  readonly stageEyebrow: (n: number, total: number, status: string) => string;
  readonly stageCompleted: string;
  readonly stageInProgress: string;
  readonly stageProgress: string;
  readonly stageProgressValue: (done: number, total: number) => string;
  readonly processComplete: string;
  readonly awaitingApprovalTitle: string;
  readonly nextStageLocked: string;
  readonly startNextCycle: string;
  readonly awaitingApprovalBody: (name: string) => string;
  readonly remainingToFinish: (n: number) => string;
  readonly remainingToApprove: (n: number) => string;
  readonly nextStageStillLocked: string;
  readonly goNextStage: string;
  readonly prevStage: string;
  readonly stageTaskList: (stageName: string) => string;
  readonly outputOf: (output: string) => string;
  readonly open: string;
  readonly openTaskInTaskView: (taskName: string) => string;
  readonly stageSummary: string;
  readonly stageOutputs: string;
  readonly nextStage: string;
  readonly lastStageNote: string;

  readonly boardTitle: string;
  readonly boardCurrent: string;
  readonly boardHint: string;
  readonly boardListLabel: (stageCount: number) => string;
  readonly allStagesDone: string;
  readonly columnAwaitingApproval: string;
  readonly tasksLeft: (n: number) => string;
  readonly taskDoneCheckbox: (taskName: string) => string;
  readonly noInputFirstTask: string;

  readonly completeAndNext: string;
  readonly completeForApproval: string;
  readonly approveAndOpenStage: (n: number) => string;
  readonly approvalAfterThis: (stage: number) => string;
  readonly awaitingApprovalHint: (stage: number) => string;
  readonly viewNextTask: string;
  readonly taskNavLabel: string;
  readonly stageDoneCount: (done: number, total: number) => string;
  readonly breadcrumbLabel: string;
  readonly breadcrumbAll: string;
  readonly none: string;
  readonly fromTask: (n: number, name: string) => string;
  readonly firstTaskNote: string;
  readonly workLog: string;
  readonly outputLink: string;
  readonly outputLinkHint: string;
  readonly notes: string;
  readonly notesPlaceholder: string;
  readonly prevTask: string;
}

const ko: Messages = {
  documentTitle: '개발 공정 관리',

  statusLocked: '잠김',
  statusDone: '완료',
  statusDoing: '지금 차례',
  statusTodo: '대기',
  statusAwaitingApproval: '승인 대기',
  statusRedoing: '재작업 중',
  statusRedoTodo: '재작업 대기',
  statusLockedRework: '잠김 · 재작업',

  requestRework: '재작업 요청',
  reworkDialogBody: (from, through, count) =>
    from === through
      ? `작업 ${from}을(를) 다시 합니다.`
      : `작업 ${from}부터 작업 ${through}까지 ${count}개가 재작업 대상이 됩니다. 앞 산출물이 바뀌므로 뒤 작업도 순서대로 다시 완료해야 합니다.`,
  reworkRevokes: (stages) => `${stages}단계 승인도 취소되어, 재작업 뒤 다시 승인을 받아야 합니다.`,
  reworkReason: '재작업 사유',
  reworkReasonPlaceholder: '무엇이 잘못되었는지, 무엇을 고칠지',
  reworkConfirm: '재작업 시작',
  cancel: '취소',
  reworkBannerTitle: '재작업 진행 중',
  reworkBannerBody: (from, through, reason) =>
    from === through ? `작업 ${from} · 사유: ${reason}` : `작업 ${from}~${through} · 사유: ${reason}`,
  stage: (n) => `${n}단계`,
  stageWithName: (n, name) => `${n}단계 ${name}`,
  task: (n) => `작업 ${n}`,
  unlocksAfter: (p) => `${p}단계가 승인되면 열립니다.`,
  taskStartsAfter: (p) => `${p}단계를 마치고 승인을 받으면 이 작업을 시작할 수 있습니다.`,
  close: '닫기',
  openInTaskView: '작업 뷰에서 열기',
  markDone: '완료로 표시',
  undoDone: '완료 취소',
  reopenRevokesApproval: (n) => `이 작업의 완료를 취소하면 ${n}단계 승인도 취소되고 다음 단계가 다시 잠깁니다.`,
  waitForPrevious: (n, name) => `작업은 순서대로 진행합니다. 먼저 작업 ${n} · ${name}을(를) 완료하세요.`,
  onlyLastReopenable: (n, name) => `완료 취소는 마지막으로 완료한 작업(작업 ${n} · ${name})만 할 수 있습니다.`,
  inheritedOutput: '이어받는 산출물',
  thisOutput: '이 작업의 산출물',
  approveStage: '승인하고 다음 단계 열기',
  restartCycle: '1단계로 · 개선 주기 시작',

  projectNamePlaceholder: '[프로젝트 이름]',
  overallProgress: (d, t) => `전체 진행 ${d} / ${t}`,
  overallProgressLabel: '전체 진행률',
  projectLabel: '프로젝트',
  viewsLabel: '보기 방식',
  views: { stage: '단계', task: '작업', board: '보드' },
  serviceNavLabel: '서비스 탐색',
  home: '홈',
  back: '뒤로',
  breadcrumb: '현재 위치',
  stageOpenedTitle: (n, name) => `${n}단계(${name})가 열렸습니다`,
  stageOpenedBody: (c) => `${c}개 작업을 시작할 수 있습니다.`,

  settings: '설정',
  appliesImmediately: '변경 사항은 바로 적용됩니다.',
  theme: '테마',
  themeLabel: { system: '시스템 설정 사용', light: '라이트', dark: '다크' },
  systemNow: (m) => `지금은 ${m === 'dark' ? '다크' : '라이트'}`,
  language: '언어',
  localeName: { ko: '한국어', en: '영어' },

  projects: '프로젝트',
  projectsDescription:
    '프로젝트는 워크플로 여러 개를 묶는 단위입니다. 프로젝트를 고르고 그 안의 워크플로를 열거나 새로 시작하세요.',
  allProjects: '프로젝트 목록',
  newProject: '새 프로젝트',
  showArchived: '보관한 프로젝트 표시',
  projectName: '이름',
  projectDescription: '설명',
  projectNameRule: (max) => `이름은 1~${max}자로 적어 주세요.`,
  projectDescriptionRule: (max) => `설명은 ${max}자까지 적을 수 있습니다.`,
  create: '만들기',
  save: '저장',
  edit: '편집',
  retry: '다시 시도',
  loading: '불러오는 중…',
  badgeCurrent: '현재',
  badgeArchived: '보관됨',
  noProjects: '프로젝트가 없습니다.',
  noActiveProjects: '활성 프로젝트가 없습니다',
  archiveProject: '보관',
  unarchiveProject: '보관 해제',
  deleteProject: '영구 삭제',
  deleteProjectWarning: '프로젝트와 모든 워크플로, 기록, 배정 및 이력이 영구 삭제됩니다. 복구할 수 없습니다.',
  archivedNotice: '보관한 프로젝트입니다. 기존 워크플로의 진행 상태와 기록을 열람할 수 있습니다.',
  workflows: '워크플로',
  noWorkflows: '아직 워크플로가 없습니다.',
  newWorkflow: '새 워크플로',
  workflowName: '워크플로 이름',
  workflowNamePlaceholder: '예: 결제 개편 1차 릴리스',
  workflowNameHint: '이번에 진행할 일의 이름을 적으세요. 비워 두면 "새 워크플로"가 됩니다.',
  workflowExplainer: (stages, tasks) =>
    `워크플로는 공정 ${stages}단계(작업 ${tasks}개)를 처음부터 끝까지 한 번 진행하는 단위입니다. 한 프로젝트에서 여러 번 시작할 수 있습니다.`,
  startWorkflow: '시작',
  openWorkflow: (name) => `${name} 열기`,
  openedWorkflow: '열려 있음',
  unsavedBlocksSwitch: '저장을 확인하지 못한 변경이 있어 다른 워크플로를 열 수 없습니다. 먼저 다시 불러오세요.',
  workflowMissing: '이 워크플로는 더 이상 없습니다. 다른 워크플로를 열거나 새로 시작하세요.',
  workflowOpenFailed: '워크플로를 열지 못했습니다. 잠시 뒤 다시 시도하거나 다른 워크플로를 여세요.',
  openProjectsPanel: '프로젝트 페이지 열기',
  projectSummary: '프로젝트 정보',
  noWorkflowEyebrow: '시작하기',
  noWorkflowTitle: '열린 워크플로가 없습니다',
  noWorkflowBody:
    '프로젝트를 만들고 그 안에서 워크플로를 시작하세요. 이미 있는 워크플로는 프로젝트 페이지에서 열 수 있습니다.',
  projectError: {
    invalid: '입력한 내용을 확인해 주세요.',
    notFound: '프로젝트를 찾을 수 없습니다. 목록을 새로 불러왔습니다.',
    versionConflict: '다른 곳에서 먼저 바뀌었습니다. 최신 내용을 불러왔으니 다시 시도해 주세요.',
    conflict: '보관한 프로젝트에는 새 워크플로를 시작할 수 없습니다.',
    unauthenticated: '로그인이 필요합니다.',
    invalidCredentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
    tooManyAttempts: '시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
    forbidden: '이 작업을 할 권한이 없습니다.',
    unknown: '서버와 통신하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  },

  signIn: '로그인',
  signOut: '로그아웃',
  signOutFailed: '로그아웃하지 못했습니다. 다시 시도해 주세요.',
  preferencesSaveFailed: '설정을 저장하지 못했습니다. 변경 내용은 보관되어 있습니다.',
  preferencesLoadFailed: '저장된 설정을 불러오지 못했습니다. 다시 시도해 주세요.',
  password: '비밀번호',
  passwordRule: (min) => `비밀번호는 ${min}자 이상으로 적어 주세요.`,
  passwordConfirm: '비밀번호 확인',
  passwordMismatch: '두 비밀번호가 서로 다릅니다.',
  setupTitle: '초기 설정',
  setupDescription: '아직 관리자가 없습니다. 첫 관리자 계정을 만드세요. 관리자는 다른 사용자를 만들고 관리합니다.',
  createAdmin: '관리자 계정 만들기',
  checkingSession: '로그인 상태를 확인하는 중…',
  sessionExpired: '세션이 끝났습니다. 다시 로그인해 주세요.',
  authUnavailable: '서버에 연결하지 못해 로그인 상태를 확인할 수 없습니다.',
  authError: {
    invalid: '입력한 내용을 확인해 주세요.',
    notFound: '요청한 대상을 찾을 수 없습니다.',
    versionConflict: '다른 곳에서 먼저 바뀌었습니다. 다시 시도해 주세요.',
    conflict: '초기 설정은 이미 끝났습니다. 로그인해 주세요.',
    unauthenticated: '로그인이 필요합니다.',
    invalidCredentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
    tooManyAttempts: '로그인 시도가 너무 많습니다. 잠시 뒤 다시 시도해 주세요.',
    forbidden: '이 작업을 할 권한이 없습니다.',
    unknown: '서버와 통신하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  },
  accountMenu: (name) => `${name} 계정`,
  systemAdmin: '시스템 관리자',
  changePassword: '비밀번호 변경',
  currentPassword: '지금 비밀번호',
  newPassword: '새 비밀번호',
  wrongCurrentPassword: '지금 비밀번호가 올바르지 않습니다.',
  passwordChanged: '비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 끝났습니다.',

  users: '사용자',
  usersDescription: '프로젝트 멤버로 넣을 사용자를 관리합니다. 사용자는 지우지 않고 비활성화합니다.',
  allUsers: '사용자 목록',
  newUser: '새 사용자',
  showInactive: '비활성 사용자 표시',
  email: '이메일',
  userName: '이름',
  emailRule: '올바른 이메일 주소를 적어 주세요.',
  userNameRule: (max) => `이름은 1~${max}자로 적어 주세요.`,
  noUsers: '사용자가 없습니다.',
  badgeInactive: '비활성',
  editUser: (name) => `${name} 편집`,
  deactivateUser: (name) => `${name} 비활성화`,
  reactivateUser: (name) => `${name} 다시 활성화`,
  deactivate: '비활성화',
  reactivate: '다시 활성화',
  duplicateEmail: '이미 쓰는 이메일입니다.',
  badgeAdmin: '관리자',
  adminSwitch: '관리자 권한',
  initialPassword: '처음 비밀번호',
  initialPasswordHint: '이 사용자에게 전달하세요. 로그인한 뒤 직접 바꿀 수 있습니다.',
  resetPassword: '새 비밀번호 (바꿀 때만)',
  resetPasswordHint: '비워 두면 그대로 둡니다. 바꾸면 이 사용자의 로그인이 모두 끝납니다.',
  currentProjectLoadFailed: '현재 프로젝트를 불러오지 못했습니다.',
  memberLoadFailed: '프로젝트 멤버를 불러오지 못했습니다.',
  userPasswordPartiallySaved:
    '사용자 정보는 저장했지만 비밀번호를 바꾸지 못했습니다. 사용자를 편집해 다시 시도해 주세요.',
  lastAdmin: '마지막 관리자는 비활성화하거나 관리자 권한을 뺄 수 없습니다.',
  adminOnly: '사용자를 만들고 바꾸는 일은 관리자만 할 수 있습니다.',

  members: '멤버',
  noMembers: '아직 멤버가 없습니다.',
  addMember: '멤버 추가',
  memberUser: '사용자',
  memberRole: '역할',
  chooseUser: '사용자 선택',
  roleLabel: { owner: '소유자', editor: '편집자', viewer: '보기 전용' },
  roleFor: (name) => `${name}의 역할`,
  removeMember: (name) => `${name} 빼기`,
  remove: '빼기',
  noUsersToAdd: '추가할 수 있는 활성 사용자가 없습니다. 사용자 페이지에서 먼저 만드세요.',
  lastOwner: '마지막 소유자는 빼거나 역할을 낮출 수 없습니다. 다른 소유자를 먼저 지정하세요.',
  inactiveCannotJoin: '비활성 사용자는 멤버로 넣을 수 없습니다.',
  rolesExplained: '소유자는 프로젝트와 멤버를 관리하고, 편집자는 워크플로를 진행하며, 보기 전용은 보기만 합니다.',
  membersOwnerOnly: '멤버를 넣고 바꾸는 일은 소유자만 할 수 있습니다.',
  yourRole: (role) => `내 역할: ${role}`,
  readOnlyNotice: '이 프로젝트에서 보기 전용 역할입니다. 진행 상태와 기록을 볼 수 있지만 바꿀 수는 없습니다.',
  readOnlyReason: '읽기 전용이므로 바꿀 수 없습니다.',
  permissionLost:
    '이 프로젝트에서 내 역할이나 담당 배정이 바뀌어 방금 변경은 저장되지 않았습니다. 서버의 최신 상태를 불러왔습니다.',
  permissionLostOnArchive: '프로젝트가 보관되어 방금 변경은 저장되지 않았습니다. 서버의 최신 상태를 불러왔습니다.',

  myWork: '내 할 일',
  myWorkDescription: '내가 멤버인 프로젝트의 워크플로에서 내가 맡은 일입니다. 항목을 누르면 그 작업으로 갑니다.',
  myWorkCount: (n) => `지금 할 일 ${n}개`,
  workGroup: { ready: '지금 할 일', waiting: '대기 중', open: '누구나 할 수 있는 일', watching: '참고' },
  workGroupHint: {
    ready: '내게 배정됐고 지금 할 수 있습니다.',
    waiting: '내게 배정됐지만 아직 차례가 아닙니다.',
    open: '아무도 배정되지 않았습니다. 편집자 이상이면 누구나 할 수 있습니다.',
    watching: '내가 협의·통보 대상인, 지금 진행 중인 단계입니다.',
  },
  workNothing: '맡은 일이 없습니다.',
  workNothingReady: '지금 할 일은 없습니다.',
  workLoadFailed: '할 일을 불러오지 못했습니다.',
  workWhere: (project, workflow) => `${project} · ${workflow}`,
  workTask: (number, name) => `작업 ${number} · ${name}`,
  workApproval: (stageNumber, stage) => `${stageNumber}단계 ${stage} 승인`,
  workWatch: (kind, stageNumber, stage) => `${stageNumber}단계 ${stage} · ${kind === 'consulted' ? '협의' : '통보'}`,
  workWaitTasks: (remaining) => `앞 작업 ${remaining}개가 끝나야 합니다.`,
  workWaitStageTasks: (remaining) => `이 단계의 작업 ${remaining}개가 끝나야 합니다.`,
  workWaitLocked: (stageNumber) => `${stageNumber}단계가 아직 잠겨 있습니다.`,
  workRework: '재작업',
  openWorkItem: (label) => `${label} 열기`,

  assignments: '담당',
  assignmentsDescription:
    '단계마다 승인자(A)와 담당(R)·협의(C)·통보(I)를 정합니다. 배정한 일은 배정된 사람만 하고, 소유자는 대신 할 수 있습니다. 비워 둔 일은 편집자 이상이면 누구나 합니다.',
  assignmentStage: '단계',
  assignmentStageSummary: (a, r) => [a ? `승인 ${a}` : '승인자 없음', ...(r > 0 ? [`담당 ${r}명`] : [])].join(' · '),
  raciMember: '멤버',
  raciColumn: { accountable: '승인 (A)', responsible: '담당 (R)', consulted: '협의 (C)', informed: '통보 (I)' },
  raciCell: (kind, member) =>
    `${member}: ${{ accountable: '승인자', responsible: '담당', consulted: '협의', informed: '통보' }[kind]}`,
  noAccountable: '승인자 없음',
  stageRaciTable: (stage) => `${stage} 단계 배정`,
  taskResponsible: '작업별 담당자',
  taskResponsibleHint: '작업에 담당자를 따로 정하지 않으면 위에서 정한 단계의 담당자를 따릅니다.',
  taskResponsibleCell: (task, member) => `${task}: ${member} 담당`,
  viewerCannotExecute: '보기 전용 멤버는 승인(A)과 담당(R)을 맡을 수 없습니다.',
  assignmentsNeedMembers: '먼저 프로젝트 페이지에서 멤버를 넣어야 배정할 수 있습니다.',
  assignmentsOwnerOnly: '배정은 소유자만 바꿀 수 있습니다.',
  assignmentsSaved: '배정을 저장했습니다.',
  assignmentsChangedElsewhere: '다른 곳에서 배정이 먼저 바뀌었습니다. 최신 배정을 불러왔으니 다시 확인해 주세요.',
  responsibleLabel: (names) => `담당: ${names}`,
  accountableLabel: (name) => `승인자: ${name}`,
  unassigned: '미배정',
  unknownUser: '(알 수 없는 사용자)',
  onlyResponsible: (names) => `담당자(${names})만 할 수 있습니다.`,
  onlyAccountable: (name) => `승인자(${name})만 할 수 있습니다.`,
  overrideTitle: '대신 실행할까요?',
  overrideBody: (names) =>
    `이 일은 ${names}에게 배정되어 있습니다. 소유자로서 대신 실행할 수 있고, 대신 실행했다는 사실이 기록에 남습니다.`,
  overrideConfirm: '대신 실행',

  stepperLabel: '개발 공정 단계',
  stepTasks: (d, t) => `${d} / ${t} 작업`,

  stageEyebrow: (n, total, status) => `${n}단계 / ${total} · ${status}`,
  stageCompleted: '완료한 단계',
  stageInProgress: '진행 중',
  stageProgress: '단계 진행률',
  stageProgressValue: (d, t) => `${d} / ${t} 작업 완료`,
  processComplete: '공정 완료',
  awaitingApprovalTitle: '승인 대기',
  nextStageLocked: '다음 단계 잠김',
  startNextCycle: '분석 결과로 다음 개선 주기를 시작하세요.',
  awaitingApprovalBody: (name) =>
    `이 단계의 작업을 모두 마쳤습니다. 산출물을 검토하고 승인하면 ${name} 단계가 열립니다.`,
  remainingToFinish: (n) => `남은 작업 ${n}개를 완료하면 공정이 끝납니다.`,
  remainingToApprove: (n) => `남은 작업 ${n}개를 순서대로 완료하면 단계를 승인할 수 있습니다.`,
  nextStageStillLocked: '다음 단계가 아직 잠겨 있습니다.',
  goNextStage: '다음 단계로',
  prevStage: '이전 단계',
  stageTaskList: (name) => `${name} 작업 목록`,
  outputOf: (o) => `산출물 · ${o}`,
  open: '열기',
  openTaskInTaskView: (name) => `${name} 작업 뷰에서 열기`,
  stageSummary: '단계 요약',
  stageOutputs: '이 단계의 산출물',
  nextStage: '다음 단계',
  lastStageNote: '마지막 단계입니다. 운영에서 얻은 데이터와 피드백으로 1단계부터 다음 개선 주기를 시작합니다.',

  boardTitle: '전체 공정 보드',
  boardCurrent: '현재',
  boardHint: '· 카드를 선택하면 상세가 열립니다.',
  boardListLabel: (n) => `${n}단계 공정`,
  allStagesDone: '모든 공정을 마쳤습니다.',
  columnAwaitingApproval: '작업 완료 · 검토 후 승인하세요.',
  tasksLeft: (n) => `남은 작업 ${n}개`,
  taskDoneCheckbox: (name) => `${name} 완료`,
  noInputFirstTask: '없음 (공정의 첫 작업)',

  completeAndNext: '완료하고 다음 작업으로',
  completeForApproval: '완료하고 단계 승인 요청',
  approveAndOpenStage: (n) => `승인하고 ${n}단계 열기`,
  approvalAfterThis: (p) => `${p}단계의 마지막 작업입니다. 완료하면 검토·승인을 거쳐 다음 단계가 열립니다.`,
  awaitingApprovalHint: (p) => `${p}단계의 작업을 모두 마쳤습니다. 산출물을 검토하고 승인하세요.`,
  viewNextTask: '다음 작업 보기',
  taskNavLabel: '공정 작업 목록',
  stageDoneCount: (d, t) => `${t}개 중 ${d}개 완료`,
  breadcrumbLabel: '경로',
  breadcrumbAll: '전체 공정',
  none: '없음',
  fromTask: (n, name) => `작업 ${n} · ${name}에서`,
  firstTaskNote: '공정의 첫 작업입니다.',
  workLog: '작업 기록',
  outputLink: '산출물 링크',
  outputLinkHint: '문서, 디자인 파일, 저장소 등 산출물이 있는 위치를 붙여 넣으세요.',
  notes: '메모',
  notesPlaceholder: '결정 사항, 남은 이슈, 검토자 의견',
  prevTask: '이전 작업',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const en: Messages = {
  documentTitle: 'Development process',

  statusLocked: 'Locked',
  statusDone: 'Done',
  statusDoing: 'Up now',
  statusTodo: 'Waiting',
  statusAwaitingApproval: 'Awaiting approval',
  statusRedoing: 'Redoing',
  statusRedoTodo: 'Redo pending',
  statusLockedRework: 'Locked · redo',

  requestRework: 'Request redo',
  reworkDialogBody: (from, through, count) =>
    from === through
      ? `Task ${from} will be redone.`
      : `Tasks ${from} to ${through} (${count}) will need to be redone. Later tasks build on this output, so they must be completed again in order.`,
  reworkRevokes: (stages) => `Approval of stage ${stages} is also revoked and must be given again after the redo.`,
  reworkReason: 'Reason for redo',
  reworkReasonPlaceholder: 'What went wrong and what needs fixing',
  reworkConfirm: 'Start redo',
  cancel: 'Cancel',
  reworkBannerTitle: 'Redo in progress',
  reworkBannerBody: (from, through, reason) =>
    from === through ? `Task ${from} · Reason: ${reason}` : `Tasks ${from}–${through} · Reason: ${reason}`,
  stage: (n) => `Stage ${n}`,
  stageWithName: (n, name) => `Stage ${n}: ${name}`,
  task: (n) => `Task ${n}`,
  unlocksAfter: (p) => `Opens when stage ${p} is approved.`,
  taskStartsAfter: (p) => `You can start this task once stage ${p} is complete and approved.`,
  close: 'Close',
  openInTaskView: 'Open in task view',
  markDone: 'Mark as done',
  undoDone: 'Mark as not done',
  reopenRevokesApproval: (n) =>
    `Marking this as not done also revokes the stage ${n} approval and locks the next stage again.`,
  waitForPrevious: (n, name) => `Tasks go in order. Complete task ${n} · ${name} first.`,
  onlyLastReopenable: (n, name) => `Only the last completed task (task ${n} · ${name}) can be marked as not done.`,
  inheritedOutput: 'Input from previous task',
  thisOutput: 'Output of this task',
  approveStage: 'Approve and open next stage',
  restartCycle: 'Back to stage 1 · Start next cycle',

  projectNamePlaceholder: '[Project name]',
  overallProgress: (d, t) => `Overall ${d} / ${t}`,
  overallProgressLabel: 'Overall progress',
  projectLabel: 'Project',
  viewsLabel: 'View',
  views: { stage: 'Stages', task: 'Tasks', board: 'Board' },
  serviceNavLabel: 'Service navigation',
  home: 'Home',
  back: 'Back',
  breadcrumb: 'Breadcrumb',
  stageOpenedTitle: (n, name) => `Stage ${n} (${name}) is open`,
  stageOpenedBody: (c) => `${plural(c, 'task is', 'tasks are')} ready to start.`,

  settings: 'Settings',
  appliesImmediately: 'Changes apply immediately.',
  theme: 'Theme',
  themeLabel: { system: 'Use system setting', light: 'Light', dark: 'Dark' },
  systemNow: (m) => `Currently ${m === 'dark' ? 'dark' : 'light'}`,
  language: 'Language',
  localeName: { ko: 'Korean', en: 'English' },

  projects: 'Projects',
  projectsDescription:
    'A project groups several workflows. Pick a project, then open one of its workflows or start a new one.',
  allProjects: 'All projects',
  newProject: 'New project',
  showArchived: 'Show archived projects',
  projectName: 'Name',
  projectDescription: 'Description',
  projectNameRule: (max) => `Use 1 to ${max} characters for the name.`,
  projectDescriptionRule: (max) => `The description can be up to ${max} characters.`,
  create: 'Create',
  save: 'Save',
  edit: 'Edit',
  retry: 'Try again',
  loading: 'Loading…',
  badgeCurrent: 'Current',
  badgeArchived: 'Archived',
  noProjects: 'No projects yet.',
  noActiveProjects: 'No active projects.',
  archiveProject: 'Archive',
  unarchiveProject: 'Unarchive',
  deleteProject: 'Delete permanently',
  deleteProjectWarning:
    'This permanently deletes the project and all its workflows, records, assignments, and history. This cannot be undone.',
  archivedNotice: 'This project is archived. You can view the progress and records of existing workflows.',
  workflows: 'Workflows',
  noWorkflows: 'No workflows yet.',
  newWorkflow: 'New workflow',
  workflowName: 'Workflow name',
  workflowNamePlaceholder: 'e.g. Payments revamp, first release',
  workflowNameHint: 'Name the piece of work you are about to run. Leave it empty for "New workflow".',
  workflowExplainer: (stages, tasks) =>
    `A workflow is one run through all ${stages} stages (${tasks} tasks) of the process, from start to finish. You can start several in one project.`,
  startWorkflow: 'Start',
  openWorkflow: (name) => `Open ${name}`,
  openedWorkflow: 'Open now',
  unsavedBlocksSwitch: 'Some changes are not confirmed as saved, so you cannot switch workflows. Reload first.',
  workflowMissing: 'This workflow no longer exists. Open another workflow or start a new one.',
  workflowOpenFailed: 'The workflow could not be opened. Try again in a moment or open another workflow.',
  openProjectsPanel: 'Open Projects page',
  projectSummary: 'Project details',
  noWorkflowEyebrow: 'Get started',
  noWorkflowTitle: 'No workflow is open',
  noWorkflowBody:
    'Create a project, then start a workflow in it. You can open existing workflows from the Projects page.',
  projectError: {
    invalid: 'Check what you entered.',
    notFound: 'The project was not found. The list has been refreshed.',
    versionConflict: 'Someone changed this first. The latest version is loaded; please try again.',
    conflict: 'You cannot start a workflow in an archived project.',
    unauthenticated: 'You need to sign in.',
    invalidCredentials: 'The email or password is incorrect.',
    tooManyAttempts: 'Too many attempts. Try again in a moment.',
    forbidden: 'You do not have permission to do this.',
    unknown: 'Could not reach the server. Try again in a moment.',
  },

  signIn: 'Sign in',
  signOut: 'Sign out',
  signOutFailed: 'Could not sign out. Please try again.',
  preferencesSaveFailed: 'Could not save your settings. Your changes have been retained.',
  preferencesLoadFailed: 'Could not load your saved settings. Please try again.',
  password: 'Password',
  passwordRule: (min) => `Use at least ${min} characters for the password.`,
  passwordConfirm: 'Confirm password',
  passwordMismatch: 'The two passwords do not match.',
  setupTitle: 'First-time setup',
  setupDescription:
    'There is no administrator yet. Create the first administrator account. Administrators create and manage other users.',
  createAdmin: 'Create administrator account',
  checkingSession: 'Checking your session…',
  sessionExpired: 'Your session has ended. Sign in again.',
  authUnavailable: 'Could not reach the server to check your session.',
  authError: {
    invalid: 'Check what you entered.',
    notFound: 'The requested item was not found.',
    versionConflict: 'Someone changed this first. Please try again.',
    conflict: 'Setup is already complete. Sign in instead.',
    unauthenticated: 'You need to sign in.',
    invalidCredentials: 'The email or password is incorrect.',
    tooManyAttempts: 'Too many sign-in attempts. Try again in a moment.',
    forbidden: 'You do not have permission to do this.',
    unknown: 'Could not reach the server. Try again in a moment.',
  },
  accountMenu: (name) => `Account: ${name}`,
  systemAdmin: 'System administrator',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  wrongCurrentPassword: 'The current password is incorrect.',
  passwordChanged: 'Password changed. Sign-ins on other devices have ended.',

  users: 'Users',
  usersDescription: 'Manage the people you can add to projects. Users are deactivated, never deleted.',
  allUsers: 'All users',
  newUser: 'New user',
  showInactive: 'Show inactive users',
  email: 'Email',
  userName: 'Name',
  emailRule: 'Enter a valid email address.',
  userNameRule: (max) => `Use 1 to ${max} characters for the name.`,
  noUsers: 'No users yet.',
  badgeInactive: 'Inactive',
  editUser: (name) => `Edit ${name}`,
  deactivateUser: (name) => `Deactivate ${name}`,
  reactivateUser: (name) => `Reactivate ${name}`,
  deactivate: 'Deactivate',
  reactivate: 'Reactivate',
  duplicateEmail: 'That email is already in use.',
  badgeAdmin: 'Admin',
  adminSwitch: 'Administrator',
  initialPassword: 'Initial password',
  initialPasswordHint: 'Pass this to the user. They can change it after signing in.',
  resetPassword: 'New password (only to change it)',
  resetPasswordHint: 'Leave empty to keep it. Changing it ends all of this user\u2019s sign-ins.',
  currentProjectLoadFailed: 'The current project could not be loaded.',
  memberLoadFailed: 'Project members could not be loaded.',
  userPasswordPartiallySaved: 'User details were saved, but the password could not be changed. Edit the user to retry.',
  lastAdmin: 'The last administrator cannot be deactivated or lose administrator rights.',
  adminOnly: 'Only administrators can create and change users.',

  members: 'Members',
  noMembers: 'No members yet.',
  addMember: 'Add member',
  memberUser: 'User',
  memberRole: 'Role',
  chooseUser: 'Choose a user',
  roleLabel: { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' },
  roleFor: (name) => `Role for ${name}`,
  removeMember: (name) => `Remove ${name}`,
  remove: 'Remove',
  noUsersToAdd: 'No active users left to add. Create one on the Users page first.',
  lastOwner: 'You cannot remove or demote the last owner. Make someone else an owner first.',
  inactiveCannotJoin: 'Inactive users cannot be added as members.',
  rolesExplained: 'Owners manage the project and its members, editors run workflows, and viewers can only look.',
  membersOwnerOnly: 'Only owners can add or change members.',
  yourRole: (role) => `Your role: ${role}`,
  readOnlyNotice: 'You are a viewer in this project. You can see progress and records but cannot change them.',
  readOnlyReason: 'This workflow is read-only.',
  permissionLost:
    'Your role or assignment in this project changed, so your last change was not saved. The latest server state has been loaded.',
  permissionLostOnArchive:
    'The project was archived, so your last change was not saved. The latest server state has been loaded.',

  myWork: 'My work',
  myWorkDescription: 'What you are responsible for across the workflows of your projects. Select an item to go to it.',
  myWorkCount: (n) => `${plural(n, 'thing', 'things')} to do now`,
  workGroup: { ready: 'To do now', waiting: 'Waiting', open: 'Open to anyone', watching: 'For reference' },
  workGroupHint: {
    ready: 'Assigned to you and ready to do.',
    waiting: 'Assigned to you, but not your turn yet.',
    open: 'Not assigned to anyone. Any editor or owner can do these.',
    watching: 'Stages in progress where you are consulted or informed.',
  },
  workNothing: 'Nothing is assigned to you.',
  workNothingReady: 'Nothing to do right now.',
  workLoadFailed: 'Could not load your work.',
  workWhere: (project, workflow) => `${project} · ${workflow}`,
  workTask: (number, name) => `Task ${number} · ${name}`,
  workApproval: (stageNumber, stage) => `Approve stage ${stageNumber}: ${stage}`,
  workWatch: (kind, stageNumber, stage) => `Stage ${stageNumber}: ${stage} · ${kind}`,
  workWaitTasks: (remaining) => `${plural(remaining, 'earlier task', 'earlier tasks')} must finish first.`,
  workWaitStageTasks: (remaining) => `${plural(remaining, 'task', 'tasks')} in this stage must finish first.`,
  workWaitLocked: (stageNumber) => `Stage ${stageNumber} is still locked.`,
  workRework: 'Rework',
  openWorkItem: (label) => `Open ${label}`,

  assignments: 'Assignments',
  assignmentsDescription:
    'For each stage, set who approves (A) and who is responsible (R), consulted (C), and informed (I). Assigned work is done only by the people assigned; owners can act on their behalf. Unassigned work is open to any editor or owner.',
  assignmentStage: 'Stage',
  assignmentStageSummary: (a, r) =>
    [a ? `Approver ${a}` : 'No approver', ...(r > 0 ? [`${r} responsible`] : [])].join(' · '),
  raciMember: 'Member',
  raciColumn: {
    accountable: 'Accountable (A)',
    responsible: 'Responsible (R)',
    consulted: 'Consulted (C)',
    informed: 'Informed (I)',
  },
  raciCell: (kind, member) =>
    `${member}: ${{ accountable: 'accountable', responsible: 'responsible', consulted: 'consulted', informed: 'informed' }[kind]}`,
  noAccountable: 'No approver',
  stageRaciTable: (stage) => `Assignments for ${stage}`,
  taskResponsible: 'Responsible per task',
  taskResponsibleHint: 'A task without its own assignee follows the stage\u2019s responsible people above.',
  taskResponsibleCell: (task, member) => `${task}: ${member} responsible`,
  viewerCannotExecute: 'Viewers cannot be accountable (A) or responsible (R).',
  assignmentsNeedMembers: 'Add members on the Projects page before assigning.',
  assignmentsOwnerOnly: 'Only owners can change assignments.',
  assignmentsSaved: 'Assignments saved.',
  assignmentsChangedElsewhere:
    'Assignments were changed elsewhere first. The latest version is loaded; please review it.',
  responsibleLabel: (names) => `Responsible: ${names}`,
  accountableLabel: (name) => `Approver: ${name}`,
  unassigned: 'Unassigned',
  unknownUser: '(unknown user)',
  onlyResponsible: (names) => `Only the responsible person (${names}) can do this.`,
  onlyAccountable: (name) => `Only the approver (${name}) can do this.`,
  overrideTitle: 'Act on their behalf?',
  overrideBody: (names) =>
    `This is assigned to ${names}. As an owner you can do it for them, and the record will show it was done on their behalf.`,
  overrideConfirm: 'Do it for them',

  stepperLabel: 'Development stages',
  stepTasks: (d, t) => `${d} / ${t} tasks`,

  stageEyebrow: (n, total, status) => `Stage ${n} of ${total} · ${status}`,
  stageCompleted: 'Completed',
  stageInProgress: 'In progress',
  stageProgress: 'Stage progress',
  stageProgressValue: (d, t) => `${d} of ${t} tasks done`,
  processComplete: 'Process complete',
  awaitingApprovalTitle: 'Awaiting approval',
  nextStageLocked: 'Next stage locked',
  startNextCycle: 'Use what you learned to start the next improvement cycle.',
  awaitingApprovalBody: (name) => `All tasks in this stage are done. Review the outputs and approve to open ${name}.`,
  remainingToFinish: (n) => `Complete the remaining ${plural(n, 'task', 'tasks')} to finish the process.`,
  remainingToApprove: (n) =>
    `Complete the remaining ${plural(n, 'task', 'tasks')} in order before approving this stage.`,
  nextStageStillLocked: 'The next stage is still locked.',
  goNextStage: 'Next stage',
  prevStage: 'Previous stage',
  stageTaskList: (name) => `${name} tasks`,
  outputOf: (o) => `Output · ${o}`,
  open: 'Open',
  openTaskInTaskView: (name) => `Open ${name} in task view`,
  stageSummary: 'Stage summary',
  stageOutputs: 'Outputs of this stage',
  nextStage: 'Up next',
  lastStageNote:
    'This is the last stage. Use operational data and feedback to start the next improvement cycle from stage 1.',

  boardTitle: 'Process board',
  boardCurrent: 'Current:',
  boardHint: '· Select a card to see details.',
  boardListLabel: (n) => `${n}-stage process`,
  allStagesDone: 'All stages are complete.',
  columnAwaitingApproval: 'Tasks done · review and approve.',
  tasksLeft: (n) => `${plural(n, 'task', 'tasks')} left`,
  taskDoneCheckbox: (name) => `${name} done`,
  noInputFirstTask: 'None (first task in the process)',

  completeAndNext: 'Complete and go to next task',
  completeForApproval: 'Complete and request approval',
  approveAndOpenStage: (n) => `Approve and open stage ${n}`,
  approvalAfterThis: (p) =>
    `This is the last task in stage ${p}. Once it is done, the stage needs review and approval before the next one opens.`,
  awaitingApprovalHint: (p) => `All tasks in stage ${p} are done. Review the outputs and approve.`,
  viewNextTask: 'View next task',
  taskNavLabel: 'Process tasks',
  stageDoneCount: (d, t) => `${d} of ${t} done`,
  breadcrumbLabel: 'Breadcrumb',
  breadcrumbAll: 'All stages',
  none: 'None',
  fromTask: (n, name) => `From task ${n} · ${name}`,
  firstTaskNote: 'This is the first task in the process.',
  workLog: 'Work log',
  outputLink: 'Output link',
  outputLinkHint: 'Paste where the output lives: a document, design file, repository, and so on.',
  notes: 'Notes',
  notesPlaceholder: 'Decisions, open issues, reviewer comments',
  prevTask: 'Previous task',
};

export const MESSAGES: Record<Locale, Messages> = { ko, en };

export const LOCALE_ENDONYM: Record<Locale, string> = { ko: '한국어', en: 'English' };
