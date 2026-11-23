# process-flow frontend

6단계 소프트웨어 개발 공정(기획·분석 → 설계·디자인 → 개발 → 테스트·QA → 배포·출시 → 운영·유지보수)을
**단계 / 작업 / 보드** 세 가지 뷰로 진행하는 웹 프론트엔드 골격입니다.
Vite + React 19 + TypeScript + Fluent UI React v9로 만들었습니다.

## 시작하기

```bash
npm install
npm run dev          # http://localhost:5173
```

시연용 상태(1단계 완료, 2단계 진행 중)로 보려면 `apps/web/.env.example`을 `apps/web/.env.local`로 복사하고 `VITE_DEMO=true`로 바꿉니다.

모든 스크립트는 `frontend/`(워크스페이스 루트)에서 실행합니다.

| 스크립트            | 설명                                                   |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | 개발 서버 (`apps/web`)                                 |
| `npm run build`     | 전체 타입 검사 후 프로덕션 빌드 (`apps/web/dist/`)     |
| `npm run preview`   | 빌드 결과 미리 보기                                    |
| `npm run typecheck` | TypeScript 검사 (모든 패키지와 테스트, web, 설정 파일) |
| `npm run lint`      | ESLint (계층 경계 규칙 포함)                           |
| `npm run test`      | Vitest: 패키지별 환경(Node/jsdom)으로 한 번에          |
| `npm run check`     | format:check + typecheck + lint + test 한 번에         |

Node.js 20.19 이상이 필요합니다.

프로덕션 빌드는 React, Fluent UI의 메뉴·서랍·대화상자 계열, 나머지 Fluent UI를 별도 청크로 묶습니다. 관련 모듈을 함께 유지하면서 기본 500kB 청크 경고 기준 안에서 분할합니다.

## 구조

npm workspaces 모노레포이며 **Clean Architecture**를 따릅니다.
`domain`과 `application`은 입력으로부터 결과를 계산합니다. `runtime`은 세션 상태를 갱신하고 포트를 호출하며, 어댑터는 해당 포트를 브라우저·HTTP API에 연결합니다.

`application/src/contexts`는 워크플로 동기화·설정·담당 배정·인증의 ADT 상태 머신과 프로젝트·멤버·사용자·내 작업의 업무 계약을 정의합니다. 순수 전이는 다음 상태와 효과 데이터를 반환하고, `runtime`이 저장소·타이머 포트로 실행한 결과를 다시 이벤트로 전달합니다. React는 구독과 생명주기를 연결하며 UI는 저장소 대신 업무별 유스케이스를 호출합니다.

업무 진행 데이터와 화면 선택 상태는 별도로 보관하고 기존 화면용 상태로 투영합니다. 저장 오류와 미저장 초안을 보존하며, 화면 종료 시 후속 저장 작업을 중단합니다. HTTP 요청과 캐시는 인증 세대에 연결해 이전 계정의 늦은 응답이 새 세션에 적용되지 않도록 합니다.

```
frontend/                         워크스페이스 루트 (공통 도구: TypeScript, ESLint, Prettier, Vitest)
├─ packages/
│  ├─ domain/                     @process-flow/domain        엔터프라이즈 규칙 (의존성 0, 순수)
│  │  └─ src/
│  │     ├─ process/              공정 모델·문구·표준 6단계 공정
│  │     ├─ workflow/             상태(state), 셀렉터, 리듀서, 진행 동작 분류(actions)
│  │     ├─ assignment/           담당 배정(RACI) 모델과 실행 근거 규칙(authority)
│  │     ├─ access.ts             역할·권한
│  │     ├─ project.ts user.ts work.ts   엔터티
│  │     └─ preferences.ts locale.ts     표시 설정 규칙, 지원 언어
│  ├─ application/                @process-flow/application   순수 정책·포트·뷰모델 (domain만 의존)
│  │  └─ src/
│  │     ├─ ports/                WorkflowRepository, ProjectRepository, UserRepository, AuthRepository,
│  │     │                        WorkRepository, Platform(ColorScheme·Document·Navigation·Scheduler)
│  │     ├─ errors.ts             RequestError (포트가 던지는 오류의 종류)
│  │     ├─ workflow/             명령 허용·병합, 서버 응답 반영, 초안 복구 정책
│  │     ├─ navigation/           라우트 해석
│  │     └─ viewModels/           화면에 무엇을, 어떤 버튼을 낼지 정하는 순수 함수
│  ├─ runtime/                    @process-flow/runtime       상태를 가진 유스케이스 실행
│  │  └─ src/
│  │     ├─ workflow/             WorkflowSession: 저장·재조회·타이머·구독 조율
│  │     └─ navigation/           메모리 방문 기록 (Navigation 포트 구현)
│  ├─ adapter-http/               @process-flow/adapter-http  저장소 포트 → 백엔드 HTTP API (fetch는 인자로)
│  ├─ adapter-browser/            @process-flow/adapter-browser 플랫폼 포트 → 브라우저 API
│  │                              (matchMedia, document, history, localStorage, beforeunload, setTimeout)
│  ├─ react/                      @process-flow/react         유스케이스를 React에 잇는 Provider·컨텍스트·훅
│  └─ ui/                         @process-flow/ui            Fluent UI 화면: components, views, pages, i18n, theme
└─ apps/web/                      @process-flow/web           조립 지점(composition root)
   └─ src/
      ├─ main.tsx                 환경 변수 읽기, 어댑터 생성 → Platform
      ├─ App.tsx                  Platform·공정을 props로 받아 Provider와 화면을 쌓음
      ├─ config.ts                환경 변수 → AppConfig (순수)
      └─ test/                    가짜 Platform·저장소와 앱 통합 테스트
```

각 패키지는 `package.json`의 `exports`로 `src/index.ts`만 공개합니다. 다른 패키지의 내부 파일은 가져올 수 없습니다.

### 계층과 의존 방향

```
apps/web ──▶ ui ──▶ react ──▶ runtime ──▶ application ──▶ domain
   └──▶ adapter-http / adapter-browser ─────────▶ application
```

표에는 각 패키지에서 직접 참조할 수 있는 의존성을 적었습니다.

| 패키지          | 의존할 수 있는 것                            | 부수효과                          | tsconfig lib | 테스트 환경 |
| --------------- | -------------------------------------------- | --------------------------------- | ------------ | ----------- |
| domain          | 없음                                         | 없음                              | ES2022       | Node        |
| application     | domain                                       | 없음                              | ES2022       | Node        |
| runtime         | domain, application                          | 세션 상태, 구독, 주입된 포트 호출 | ES2022       | Node        |
| adapter-http    | domain, application                          | HTTP 요청                         | ES2022 + DOM | Node        |
| adapter-browser | domain, application                          | 브라우저 API, 타이머              | ES2022 + DOM | jsdom       |
| react           | domain, application, runtime, React          | React 상태와 생명주기             | ES2022       | -           |
| ui              | domain, application, react, React, Fluent UI | UI 상태와 사용자 이벤트           | ES2022 + DOM | -           |
| apps/web        | 모두                                         | 조립과 실행                       | ES2022 + DOM | jsdom       |

- **의존성은 안쪽을 향합니다.** `runtime`의 워크플로 세션은 `application`의 명령·초안 정책을 사용하고, 저장소와 스케줄러 포트를 호출합니다. `main.tsx`가 브라우저와 HTTP 어댑터를 조립합니다.
- **경계는 도구로 검사합니다.** 순수 패키지와 `runtime`은 DOM 타입 없이 컴파일합니다. 각 패키지는 `exports`로 공개 진입점을 정의합니다. ESLint는 계층별 import와 브라우저 전역을 제한하고, 다른 워크스페이스를 상대 경로로 가져오면 오류를 냅니다.
- **테스트 환경은 계층에 맞춥니다.** 도메인·애플리케이션 정책은 Node에서 검사합니다. 세션은 가짜 저장소와 스케줄러를 사용하고, 웹 통합 테스트는 가짜 Platform(`apps/web/src/test/fakePlatform.ts`)으로 사용자 흐름을 확인합니다.

### 설계 원칙

- **규칙은 한 곳에만**: 진행 상태는 합 타입 `Phase`(`working | awaitingApproval | finished`) 하나이고, "순서대로 완료, 단계 사이 승인, 마지막 완료만 취소" 규칙은 그 전이 함수(`packages/domain/src/workflow/phase.ts`)만 판단합니다. 리듀서와 화면은 그 결과를 쓸 뿐입니다.
  규칙에 맞지 않는 액션은 같은 상태 객체를 그대로 돌려주므로, 버튼 비활성화가 빠져도 규칙은 깨지지 않습니다.
- **공정은 데이터**: 리듀서와 셀렉터는 공정을 인자로 받습니다. 표준 공정 대신 다른 공정을 `defineProcess`로 만들어 `App`에 넘겨도 같은 규칙이 적용됩니다.
- **뷰는 보여 주기만**: 어떤 버튼을 낼지, 왜 막혔는지는 뷰모델이 종류(kind)와 숫자로 돌려주고, 뷰는 그것을 문구로 바꾸고 `dispatch(action)`만 합니다.
- **색은 토큰으로**: 컴포넌트에서 색상 값(`#RRGGBB`)을 쓰면 ESLint가 오류를 냅니다. 색은 `tokens.*`만 쓰고,
  브랜드 색 원본은 `packages/ui/src/theme/brand.ts`에만 둡니다.
- **테마**: 헤더의 설정(톱니바퀴) 패널에서 시스템 설정 사용 / 라이트 / 다크를 고릅니다. 기본값은 시스템 설정이며,
  다크 테마는 브랜드 배경 위 흰 글자의 대비를 위해 배경 단계를 조정했습니다.
- **다국어**: 같은 패널에서 한국어 / English를 고릅니다. 서버에 저장된 값이 없으면 브라우저 선호 언어를 따르고, 지원하지 않는 언어면 한국어로 시작합니다.
  고른 언어와 테마는 워크스페이스 설정으로 서버에 저장됩니다(시연 모드에서는 이번 세션 동안만 유지).
  - 화면 문구는 `packages/ui/src/i18n/messages.ts`에 있습니다. `Messages` 타입이 두 언어에 같은 키를 강제하므로 번역을 빠뜨리면 타입 검사에서 실패합니다.
  - 공정 내용(단계·작업 이름, 설명, 산출물)은 `packages/domain/src/process/standard.ts`에 언어별로 있고, 단계·작업 **ID로** 연결됩니다.
    문구 사전의 키가 ID 유니온 타입이라, 작업을 추가하고 문구를 빠뜨리거나 없는 ID를 쓰면 타입 검사에서 실패합니다.
  - `VITE_SERVICE_NAME`·`VITE_PROJECT_NAME`으로 준 이름은 번역하지 않고 그대로 보여 줍니다.
    서비스 이름의 기본값은 **Process Flow**이며, 브라우저 탭 제목에도 함께 표시됩니다(`개발 공정 관리 · Process Flow`).

### Fluent UI 컴포넌트 대응

| 화면 요소      | 사용한 컴포넌트                                                                  |
| -------------- | -------------------------------------------------------------------------------- |
| 뷰 전환        | `TabList`, `Tab`                                                                 |
| 진행률         | `ProgressBar`                                                                    |
| 카드 표면      | `Card`                                                                           |
| 단계 스테퍼    | 직접 조합 (v9에 Stepper 없음) + `useArrowNavigationGroup`                        |
| 작업 사이드바  | `NavDrawer`(inline), `NavCategory`, `NavSubItem`, `CounterBadge`                 |
| 경로           | `Breadcrumb`                                                                     |
| 작업 기록      | `Field`, `Input`, `Textarea`                                                     |
| 안내           | `MessageBar`                                                                     |
| 비활성 이유    | `Tooltip` + `disabledFocusable` (`DisabledReason`)                               |
| 보드 카드 상세 | `OverlayDrawer`                                                                  |
| 설정 패널      | `OverlayDrawer`, `RadioGroup`, `Radio` (테마 미리보기는 테마별 `FluentProvider`) |
| 단계 열림 알림 | `Toaster`, `Toast`                                                               |
| 상태 표시      | `Badge`                                                                          |

## 아직 없는 것 (다음 단계 후보)

- **사용자·권한**: 단계 승인자, 담당자 지정.
- **산출물 첨부**: 지금은 링크만 기록합니다.
- **라우팅**: 뷰와 선택한 작업을 URL에 반영하면 공유 링크를 만들 수 있습니다.
- **글꼴**: Segoe UI는 자동으로 로드되지 않습니다. Windows가 아닌 환경에서는 시스템 글꼴과 맑은 고딕/Apple SD Gothic Neo로 대체됩니다.

## 백엔드 저장과 복원

기본 실행은 백엔드 API를 사용합니다. `backend/`에서 `cargo run -p process-flow-server`를 실행하고,
`frontend/`에서 `npm run dev`를 실행합니다. Vite는 `/api` 요청을 `http://127.0.0.1:8080`으로 전달합니다.
배포 환경에서도 같은 출처의 `/api`를 백엔드로 프록시해야 합니다.
`VITE_DEMO=true`는 서버에 저장하지 않는 시연 모드입니다.

첫 접속 시 표준 공정 워크플로를 만들고 `?workflow=<id>`와 localStorage에 ID를 보관합니다.
URL의 ID가 우선하며, 이후 새로고침은 같은 워크플로를 조회합니다. 없는 ID나 서버 오류가 발생해도
다른 워크플로로 자동 대체하지 않습니다. 작업 완료·열린 단계·링크·메모는 DB에 저장합니다.
보기 방식과 선택한 작업은 화면 상태이며, 언어·테마는 기존처럼 브라우저에 저장합니다.

명령은 마지막 응답의 버전으로 순서대로 전송합니다. 링크·메모는 마지막 입력 후 500ms 뒤에 저장하며,
화면의 **저장 완료** 표시를 확인한 후 페이지를 닫습니다. 저장 중에는 페이지 이탈 경고를 요청합니다.
저장 실패·버전 충돌 시 자동으로 명령을 반복하지 않습니다. 화면에서 입력 내용을 복사한 뒤
**미저장 변경 버리고 다시 불러오기**로 서버 상태를 확인할 수 있습니다.

단계의 마지막 미완료 작업을 순서와 관계없이 `completeAndNext`로 완료하면 다음 단계가 열립니다.
빈 링크·메모는 기록에서 제거합니다. 서버가 업무 상태의 최종 기준입니다.

### 실제 DB 저장·복원 통합 테스트

먼저 `backend/`에서 `cargo build -p process-flow-server`를 실행합니다.
이후 `frontend/`에서:

```bash
TEST_BACKEND=1 npm test
```

PowerShell에서는 `$env:TEST_BACKEND='1'; npm test`를 사용합니다.
테스트는 임시 DB와 별도 포트를 사용하여 화면 조작으로 완료 상태·단계·링크·메모를 저장하고,
서버 재시작 및 앱 재마운트 후 같은 ID와 데이터가 복원되는지 검사합니다.
일반 `npm test`는 Rust 실행 파일 없이 실행할 수 있도록 이 테스트만 건너뜁니다.

## 작업 문서와 증빙

단계·보드에서 작업을 열면 문서형 상세 화면이 나옵니다. 표준 25개 작업의 필수 항목을 작성하고
검토 결과를 통과로 선택한 뒤 완료합니다. 작성 내용은 자동 저장되며, 완료 전 저장 성공을 확인합니다.
증빙은 필수 내용을 대신하지 않습니다. 링크는 HTTP(S)만 허용하고 파일은 다운로드로 제공합니다.
파일당 2 MiB, 워크플로 전체 8 MiB, 작업당 증빙 20개를 지원합니다.

완료한 문서는 완료 취소·재작업 후 수정합니다. 기존 메모와 링크는 추가 기록에서 확인할 수 있습니다.
예전 완료 기록이 새 양식에 맞지 않으면 내용 확인 필요로 표시하며 단계 승인 전에 보완해야 합니다.
서버와 저장 충돌이 나면 **초안 보관하고 다시 불러오기**를 눌러 최신 문서와 보관된 초안을 비교하고,
**보관된 초안 적용**으로 명시적으로 복구합니다. 완료·잠금 상태의 작업은 먼저 완료 취소·재작업이 필요합니다.
보관된 초안은 현재 세션 메모리에 있으므로 페이지를 닫기 전에 복구해야 합니다.

양식 원본은 저장소 루트 `contracts/task-forms.json`입니다. 루트에서 `node tools/catalog/generate.mjs`를 실행해 프런트엔드 JSON과 Rust 정적 데이터를 함께 갱신합니다. `npm run check`는 생성물 일치와 workspace 의존 경계를 함께 검사합니다.
브라우저 파일 읽기·다운로드는 `EvidenceFiles` 포트를 통해 어댑터에서 실행됩니다.
