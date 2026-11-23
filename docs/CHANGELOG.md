# 변경 이력

이 프로젝트의 주요 변경 사항을 기록합니다.
형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따릅니다.

## [Unreleased]

### 문서 기반 작업 완료 (2026-11-15)

- 표준 25개 작업에 119개 필수 작성 항목과 검토 결과를 추가했습니다. 내용과 검토가 충족되어야 서버가 완료·단계 승인을 허용합니다.
- 단계·보드의 완료 체크박스를 없애고 문서 상세에서 작성 후 완료하도록 바꿨습니다. 이전 작업의 실제 내용과 단계별 산출물을 검토할 수 있습니다.
- 제목·설명이 있는 여러 링크와 첨부파일 증빙을 작업 기록과 함께 저장합니다. 파일당 2 MiB, 워크플로 전체 8 MiB, 작업당 증빙 20개를 제한합니다.
- 완료한 문서·증빙은 재작업 전환 전까지 편집할 수 없습니다. 기존 메모·링크는 보존하고, 새 기준 미충족 완료 기록은 보완 필요 상태로 표시합니다.
- 저장 충돌 시 최신 서버 내용과 로컬 초안을 분리해 보관하고, 사용자가 확인한 뒤 초안을 적용합니다. 파일 읽기 중 편집과 완료를 막고, 작업 이동 시 늦게 도착한 파일 결과를 폐기합니다.

### 백엔드 Clean Architecture 크레이트 재구성 (2026-11-14)

#### 변경

- **워크스페이스 구조**: 순수 코드는 `crates/core/`(`domain`, `application`), 부수효과는 `crates/adapters/`로 디렉터리부터 나눴습니다. 동작과 API는 바뀌지 않습니다.
  - `process-flow-infrastructure`를 기술별 어댑터 크레이트로 쪼갰습니다: `process-flow-adapter-surreal`(SurrealDB), `-security`(argon2·토큰), `-embedding`(해시 임베더), `-system`(시계·UUID). 각 크레이트는 자기 기술의 외부 크레이트만 압니다.
  - `process-flow-api`는 `crates/adapters/api`로 옮겼습니다(구동 어댑터).
  - 포트의 메모리 구현을 `process-flow-application`의 `testing` 기능에서 꺼내 `process-flow-testing` 크레이트(`store`·`fakes`·`services`)로 옮겼습니다. 테스트에서만 dev-dependency로 씁니다.
  - `apps/server`의 조립과 시작 시 시드·데이터 이전을 `main.rs`에서 `wiring.rs`로 분리했습니다.
- **경계 강제**: `crates/core/clippy.toml`이 코어에서 시계·환경 변수·파일·스레드·네트워크·프로세스·출력 사용을 금지합니다(`cargo clippy -- -D warnings`에서 오류).

### 프론트엔드 Clean Architecture 패키지 분리 (2026-11-14)

#### 변경

- **워크스페이스 구조**: `packages/core`와 `apps/web` 안의 폴더로만 나뉘던 계층을 패키지로 분리했습니다. 동작은 바뀌지 않습니다.
  - `@process-flow/domain`(구 `@process-flow/core`): 공정·진행 규칙에 더해, `ports.ts`에 섞여 있던 엔터티(프로젝트·사용자·역할·권한·담당 배정·할 일)와 실행 근거 규칙(`authority`)을 옮겼습니다.
  - `@process-flow/application`: 포트(저장소별 파일로 분리), `RequestError`, `WorkflowSession`, 라우트, 뷰모델.
  - `@process-flow/adapter-http`, `@process-flow/adapter-browser`: 포트 구현. 브라우저 어댑터는 포트마다 한 파일로 나눴습니다.
  - `@process-flow/react`: Provider·컨텍스트·훅. `@process-flow/ui`: Fluent UI 화면.
  - `apps/web`: 조립 지점(`main.tsx`, `App.tsx`, `config.ts`)과 통합 테스트만 남았습니다.
- **타이머도 포트로**: `WorkflowSession`이 `setTimeout`을 직접 쓰지 않고 `Scheduler` 포트(`Platform.scheduler`)로 기록 저장을 예약합니다. 애플리케이션 계층에 부수효과가 남지 않습니다.
- **경계 강제**: ESLint가 패키지마다 의존할 수 있는 안쪽 패키지만 허용합니다. `react` 패키지도 DOM lib 없이 컴파일해 브라우저 API를 쓰면 오류가 납니다.

### 페이지 본문 전체 폭 (2026-11-14)

#### 변경

- **프로젝트·사용자·내 할 일 페이지**: 본문을 880px로 묶던 제한을 없애, 머리글과 같은 폭(왼쪽 시작선과 오른쪽 끝)을 씁니다. 넓은 화면에서 본문이 왼쪽으로 치우쳐 보이던 문제를 고쳤습니다.
- **목록 행**: 사용자·워크플로·멤버 목록에서 마우스를 올린 행에 배경을 깔아, 길어진 행의 이름과 오른쪽 버튼이 한 줄로 읽히게 했습니다.

### 담당 페이지의 단계 스테퍼 (2026-11-14)

#### 변경

- **담당 페이지**: 단계 고르기 콤보박스를 워크플로 화면과 같은 번호 스테퍼로 바꿨습니다. 단계마다 배정 요약("승인 김개발 · 담당 2명")을 보여 주고, 승인자가 없는 단계는 경고 색으로 "승인자 없음"이라고 알립니다. 저장하기 전의 편집도 요약에 바로 반영됩니다. 배정은 아직 열리지 않은 단계에도 할 수 있어 잠금 표시는 없습니다.
- **키보드·스크린 리더**: 스테퍼는 탭 목록(tablist)이고 아래 배정 표가 그 탭 패널입니다. 좌우 화살표 키로 단계 사이를 옮겨 다닙니다.

### 서랍 대신 페이지 (2026-11-14)

#### 변경

- **프로젝트·사용자·담당·내 할 일**: 옆에서 열리던 서랍(패널)을 각각 개별 페이지로 바꿨습니다. 머리글 메뉴는 그대로 있고, 지금 보고 있는 페이지의 메뉴가 선택된 모양으로 표시됩니다(`aria-current="page"`). 내 할 일은 프로필 메뉴에서 엽니다. 설정은 서랍으로 남아 있습니다.
- **페이지 머리글**: 모든 페이지 맨 위에 뒤로 가기 버튼과 빵 부스러기(홈 › 프로젝트 › 프로젝트 이름)가 있습니다. 홈은 워크플로 화면입니다. 담당 페이지에는 어느 워크플로의 배정인지 제목 옆에 표시됩니다.
- **주소와 방문 기록**: 페이지마다 주소가 있습니다(`#/projects`, `#/projects/<id>`, `#/users`, `#/assignments`, `#/my-work`). 새로 고침하거나 주소를 공유해도 같은 페이지가 열리고, 브라우저의 뒤로·앞으로 버튼도 동작합니다. 앱 안에서 앞서 본 화면이 없으면(주소로 바로 들어왔으면) 뒤로 가기는 한 단계 위 페이지로 갑니다.
- **워크플로 열기**: 프로젝트 페이지에서 워크플로를 열거나 시작하면, 또는 내 할 일에서 항목을 누르면 워크플로 화면으로 돌아갑니다.
- **포커스**: 페이지가 열리면 제목으로, 페이지에서 홈으로 돌아오면 워크플로 제목으로 키보드 포커스가 옮겨 갑니다.

### 프로필 메뉴로 옮긴 내 할 일 (2026-11-14)

#### 변경

- **머리글**: 상단의 "내 할 일" 버튼을 없애고, 오른쪽 끝의 프로필 메뉴에서 엽니다. 프로필 버튼은 Fluent 2의 원형 아바타(이니셜)이고, 지금 할 일이 있으면 아바타 위에 개수 배지가 겹쳐 보입니다.
- **프로필 메뉴**: 맨 위에 사용자 카드(이름·이메일·시스템 관리자 여부), 그 아래 내 할 일(개수 배지)·비밀번호 변경·로그아웃을 구분선으로 나눠 보여 줍니다.

### 내 할 일 (2026-11-14)

#### 추가

- **`GET /api/v1/me/work`**: 내가 멤버인 프로젝트의 워크플로에서 내가 맡은 일을 모아 돌려줍니다. 지금 할 일(`ready`), 대기 중(`waiting`, 이유 포함), 누구나 할 수 있는 일(`open`), 참고(`watching`)로 나뉩니다. 내 배정은 잠긴 단계까지 모두, 배정이 없는 일은 지금 차례인 것만 나옵니다.
- **프런트엔드**: 연 워크플로가 없을 때의 첫 화면에 내 할 일이 보이고, 상단의 "내 할 일" 버튼(지금 할 일 개수 표시)으로 패널을 엽니다. 항목을 누르면 그 워크플로를 열어 그 작업(승인·참고는 그 단계)으로 갑니다. 진행 상태 저장이 끝날 때와 패널을 열 때 다시 불러옵니다.
- 워크플로를 열면서 처음 보여 줄 작업을 넘길 수 있습니다(`openWorkflow(id, focus)`). 화면 설정으로 저장하지는 않습니다.

### 담당 배정(RACI)과 강제 (2026-11-14)

RBAC·RACI 도입의 3단계입니다. 워크플로마다 누가 무엇을 맡는지 정하고, 배정된 일은 배정된 사람만 하게 합니다.

#### 추가

- **담당 배정**: 단계마다 승인자(A)·기본 담당자(R)·협의(C)·통보(I)를, 작업마다 담당자(R)를 정합니다. `GET`·`PUT /api/v1/workflows/{workflowId}/assignments`(소유자만 수정, 버전으로 낙관적 잠금, 변경 이력 `assignment_change`).
- **강제**: 작업 완료·완료 취소·기록 수정은 담당자가, 단계 승인과 재작업 요청은 승인자가 합니다. 소유자(관리자 포함)는 대신 할 수 있고, 배정이 없는 일은 이전처럼 편집자 이상이면 누구나 합니다.
- **실행 근거 기록**: `workflow_event.authority`에 `assigned`·`open`·`override`가 남습니다.
- **응답의 `assignments`·`authority`**: 워크플로 응답에 배정과, 요청자가 각 작업·단계를 실행할 수 있는지가 담깁니다.
- **프런트엔드**: 상단의 "담당" 패널(단계를 골라 멤버별로 A·R·C·I를 정하고 작업별 담당자를 정하는 표), 단계·작업 화면의 담당자·승인자 표시, 담당이 아닌 버튼의 비활성화와 이유, 소유자가 대신 실행할 때의 확인 창(같은 작업·단계는 한 번만 묻습니다).

#### 변경

- 멤버에서 빠지거나 보기 전용으로 낮아지면 그 사람의 배정이 풀립니다(풀린 일은 편집자 이상이면 누구나 합니다).
- 권한 `assignments.manage`(소유자)가 생겼습니다.

#### 고침

- **HTTP 어댑터가 403을 구분하지 못하던 문제**: 워크플로 명령이 권한 때문에 거절돼도 일반 오류로 처리되어, "권한이 바뀌어 저장되지 않았습니다" 안내와 서버 상태로 되돌리기가 실제 서버에서는 동작하지 않았습니다(테스트용 가짜 서버에서만 동작). 403에 `forbidden` 종류를 붙이도록 고쳤습니다.

### 프로젝트 역할로 권한 검사 (2026-11-14)

RBAC·RACI 도입의 2단계입니다. 기록만 하던 프로젝트 역할(소유자·편집자·보기 전용)이 실제로 접근을 막습니다.

#### 추가

- **권한 표**: 보기 전용은 보기와 검색만, 편집자는 워크플로 시작·명령·화면 설정 저장까지, 소유자는 프로젝트 수정·보관과 멤버 관리까지 합니다(`domain/src/membership.rs`의 `Permission`).
- **응답의 `role`·`permissions`**: 프로젝트와 워크플로 응답에 요청자의 역할과 할 수 있는 일이 담깁니다.
- **프런트엔드**: 권한이 없는 동작(프로젝트 편집·보관, 워크플로 시작, 멤버 변경)을 숨기고 내 역할을 보여 줍니다. 보기 전용이면 워크플로 화면이 읽기 전용이 되고(안내, 체크박스·기록·완료·승인 비활성), 쓰는 도중 역할이 낮아져 명령이 거절되면 변경을 버리고 서버 상태로 돌아가 알립니다.

#### 변경

- **멤버가 아닌 프로젝트는 보이지 않습니다**: 목록·검색에서 빠지고, 직접 요청하면 404입니다. 역할이 모자라면 403 `forbidden`입니다.
- **프로젝트를 만든 사람이 소유자가 됩니다**(`ProjectRepository::insert`가 소유자를 함께 저장).
- **시스템 관리자는 모든 프로젝트에서 소유자로 동작합니다.**
- `GET /api/v1/users/{userId}/projects`는 자기 것이나 관리자만 봅니다.
- `RecordIndex::nearest`가 워크플로 하나 대신 워크플로 목록으로 범위를 받습니다.

#### 고침

- **워크플로를 바꾼 뒤 화면 전체가 스크린 리더에서 사라지던 문제**: 프로젝트 패널에서 워크플로를 열거나 시작하면 패널이 열린 채 화면을 다시 만들면서 `#root`에 `aria-hidden="true"`가 남았습니다. 포커스 관리자를 다시 만들어지지 않는 자리(`App`)에서 붙들어 두어 고쳤습니다.

#### 이전

- 관리자가 아닌 사용자는 멤버로 들어간 프로젝트만 봅니다. 멤버가 없는 기존 프로젝트는 관리자에게만 보이므로, 관리자가 소유자를 정해 줘야 합니다.

### 로그인과 행위자 기록 (2026-11-14)

RBAC·RACI 도입의 1단계입니다. 요청마다 "누가"를 확정하고 이벤트에 남깁니다. 프로젝트 역할에 따른 권한 검사는 아직 없습니다.

#### 추가

- **로그인**: 이메일과 비밀번호(8~128자, argon2id 해시)로 로그인합니다. 세션은 DB에 다이제스트로 저장하고 `HttpOnly`·`SameSite=Lax` 쿠키로 주고받습니다. `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`·`login`·`logout`·`password`.
- **초기 설정**: 활성 관리자가 없으면 처음 접속한 사람이 첫 관리자 계정을 만듭니다. 같은 이메일의 사용자가 이미 있으면 그 사용자를 관리자로 올립니다.
- **시스템 관리자(`User.isAdmin`)**: 사용자를 만들고, 수정·비활성화하고, 비밀번호를 정하는 일은 관리자만 합니다(`PUT /api/v1/users/{userId}/password` 추가). 마지막 활성 관리자는 낮추거나 비활성화할 수 없습니다.
- **행위자 기록**: `workflow_event.actor`에 명령을 실행한 사용자를 남깁니다. 이전 이벤트에는 비어 있습니다.
- 로그인 실패 제한(한 이메일 15분에 10번 → 429), 세션 수명 `SESSION_TTL_HOURS`(기본 7일, 쓸 때마다 연장), `COOKIE_SECURE`.
- **프런트엔드**: 초기 설정·로그인 화면, 머리글의 계정 메뉴(비밀번호 변경·로그아웃), 세션이 끝나면 로그인 화면으로 돌아가기. 사용자 패널에 처음 비밀번호·새 비밀번호·관리자 권한이 생겼고, 관리자가 아니면 목록만 봅니다.

#### 변경

- **`/health`와 `/api/v1/auth/*`를 뺀 모든 API가 로그인을 요구합니다**(없으면 401 `unauthenticated`). 권한이 없으면 403 `forbidden`입니다.
- `POST /api/v1/users`에 `password`가 필요하고, 사용자 응답에 `isAdmin`이 생겼습니다.
- CORS가 자격 증명(쿠키)을 허용합니다. 허용 출처는 그대로 `CORS_ALLOWED_ORIGINS`에 적은 것만입니다.

#### 이전

- 있던 사용자는 `isAdmin: false`가 되고 비밀번호가 없어 로그인할 수 없습니다. 초기 설정으로 관리자를 만든 뒤, 관리자가 사용자 패널에서 비밀번호를 정해 줍니다.

### 기본 프로젝트·기본 워크플로 없애기 (2026-11-14)

#### 변경

- **기본 프로젝트가 없습니다**: 서버가 시작할 때 `project:default`를 만들지 않습니다. 처음 띄운 서버에는 프로젝트도 워크플로도 없습니다. 이미 있던 `project:default`는 보통 프로젝트가 되어 보관할 수 있습니다.
- **`POST /api/v1/workflows`에 `projectId`가 필요합니다**: 없으면 400 `badRequest`입니다. `POST /api/v1/projects/{projectId}/workflows`는 그대로입니다.
- **기본 워크플로가 없습니다**: 프런트엔드는 고른 워크플로(`?workflow=`나 마지막 워크스페이스)가 없으면 워크플로를 새로 만들지 않습니다. 대신 "열린 워크플로가 없습니다" 안내와 "프로젝트 패널 열기" 버튼을 보여 주고, 진행률·보기 탭은 숨깁니다. `WorkflowRepository.open()`은 이때 `undefined`를 돌려주고, 세션 상태는 `empty`입니다.
- 워크플로를 열지 못했을 때 보이던 "기본 프로젝트에 새 워크플로 시작" 버튼과 프로젝트의 "기본" 배지, `Project.isDefault`를 없앴습니다.

#### 이전

- 프로젝트가 없던 예전 워크플로가 남아 있을 때만, 서버가 시작할 때 보통 프로젝트 "이전 워크플로"를 만들어 옮깁니다(`SurrealWorkflowStore::count_orphans`).

### 프런트엔드: 사용자와 프로젝트 멤버 화면 (2026-11-14)

#### 추가

- **사용자 패널**: 상단 바의 "사용자" 버튼으로 엽니다. 사용자를 만들고(이메일·이름), 편집하고, 비활성화·다시 활성화합니다. "비활성 사용자 표시"로 비활성 사용자도 봅니다. 이미 쓰는 이메일이면 알려 줍니다.
- **프로젝트 멤버**: 프로젝트 상세 아래에 멤버 목록이 생겼습니다. 사용자와 역할(소유자·편집자·보기 전용)을 골라 넣고, 목록에서 역할을 바꾸거나 뺍니다. 넣고 나면 역할 선택은 편집자로 돌아갑니다. 마지막 소유자를 낮추거나 빼면 이유를 보여 주고 원래 역할로 되돌립니다. 역할은 아직 권한을 제한하지 않는다고 안내합니다.
- 포트 `UserRepository`와 HTTP 어댑터 `createUserRepository`. 사용자 저장소가 없으면 사용자 버튼과 멤버 영역을 숨깁니다.

#### 변경

- `ProjectRequestError`를 `RequestError`로, 오류 종류 `archived`를 `conflict`로 바꿨습니다(409 `conflict`가 보관 외의 이유도 뜻하게 되어서). HTTP 호출은 `adapters/http/jsonClient.ts`로 모았습니다.

### 백엔드: 사용자와 프로젝트 멤버십 (2026-11-14)

#### 추가

- **사용자 API**: `GET·POST /api/v1/users`, `GET·PATCH·DELETE /api/v1/users/{userId}`, `GET /api/v1/users/{userId}/projects`. 이메일은 소문자로 정규화해 유일하게 두고(중복이면 409 `conflict`), 수정은 `expectedVersion`으로 낙관적 잠금을 겁니다. 삭제 대신 비활성화(`active: false`)합니다.
- **멤버십 API**: `GET /api/v1/projects/{projectId}/members`, `PUT·DELETE /api/v1/projects/{projectId}/members/{userId}`. 역할은 `owner`·`editor`·`viewer`이고, `PUT`은 넣기와 역할 변경을 함께 합니다(멱등).
- **규칙**: 소유자가 있는 프로젝트의 마지막 소유자는 빼거나 낮출 수 없습니다(409). 비활성 사용자는 새 멤버로 넣을 수 없습니다(409). 역할은 아직 기록만 하고 권한 검사에는 쓰지 않습니다.
- **저장소**: `user` 테이블(`user_email` 고유 인덱스), 그래프 간선 `member_of`(`user → project`, `member_of_pair` 고유 인덱스).
- CORS에 `PUT`을 허용합니다.

### 프런트엔드: 프로젝트 화면 (2026-11-14)

#### 추가

- **프로젝트 패널**: 상단 바의 "프로젝트" 버튼으로 엽니다. 목록에서 프로젝트를 만들고(이름 1~100자, 설명 2000자까지), 상세에서 이름·설명 편집, 보관·보관 해제를 합니다. "보관한 프로젝트 표시"로 보관한 것도 볼 수 있습니다. 기본 프로젝트는 보관 버튼 대신 안내를 보여 줍니다.
- **워크플로 전환**: 프로젝트 상세에서 그 프로젝트의 워크플로를 열거나 새로 시작합니다. 열면 남은 저장을 마친 뒤 세션을 새로 만들고, 주소의 `?workflow=`와 마지막 워크스페이스도 바뀝니다. 저장을 확인하지 못한 변경이 있으면 전환을 막습니다.
- **머리글**: "프로젝트 · {프로젝트 이름}"과 워크플로 이름을 보여 줍니다. 시연 모드(`VITE_DEMO=true`)는 예전처럼 `VITE_PROJECT_NAME`을 쓰고 프로젝트 버튼이 없습니다.
- **충돌 처리**: 다른 곳에서 먼저 바뀐 프로젝트를 저장하면(409 `versionConflict`) 알리고 최신 내용을 다시 불러옵니다.
- 포트 `ProjectRepository`와 HTTP 어댑터 `createProjectRepository`, `WorkflowRepository.switchTo`.

### 백엔드: 프로젝트 관리 (2026-11-14)

프로젝트 하나에 워크플로(공정 인스턴스)를 여러 개 두고 관리합니다(1:N).

#### 추가

- **API**: `GET·POST /api/v1/projects`, `GET·PATCH·DELETE /api/v1/projects/{projectId}`, `GET·POST /api/v1/projects/{projectId}/workflows`, `GET /api/v1/workflows?projectId=`. 프로젝트 수정은 `expectedVersion`으로 낙관적 잠금을 겁니다.
- **보관**: 삭제 대신 `archived`로 보관합니다(`DELETE`나 `PATCH {"archived": true}`). 보관한 프로젝트에는 새 워크플로를 시작할 수 없고(409 `conflict`), 있던 워크플로는 계속 진행합니다. `PATCH {"archived": false}`로 되돌립니다.
- **기본 프로젝트**: 서버가 시작할 때 `project:default`("기본 프로젝트")를 만들고, 프로젝트가 없던 예전 워크플로를 여기로 옮깁니다. 보관할 수 없습니다.
- **저장소**: `project` 테이블, `workflow.project` 필드와 `workflow_by_project` 인덱스.

#### 변경

- 워크플로 응답(상세·목록)에 `projectId`가 생겼습니다.
- `POST /api/v1/workflows`는 `projectId`를 받을 수 있고, 없으면 기본 프로젝트에 시작합니다. 지금 프런트엔드는 바꾸지 않아도 그대로 동작합니다.
- 이름 없이 시작한 워크플로의 기본 이름을 "새 프로젝트"에서 "새 워크플로"로 바꿨습니다.
- CORS에 `DELETE`를 허용합니다.

### 프런트엔드: 언어·테마를 서버에만 저장 (2026-11-14)

#### 변경

- 언어·테마는 워크스페이스 설정(`/api/v1/workflows/{workflowId}/preferences`)에만 저장합니다. 서버 값이 도착하기 전에는 브라우저 선호 언어와 시스템 테마로 그립니다.
- 시연 모드(`VITE_DEMO=true`)처럼 서버가 없으면 고른 언어·테마는 이번 세션 동안 메모리에만 남습니다.

#### 제거

- `localStorage`의 `process-flow:preferences` 캐시와 이를 읽고 쓰던 `PreferencesStore` 포트, `createLocalStoragePreferencesStore`, 코어의 `parsePreferences`/`serializePreferences`. `initialPreferences`는 저장값 인자 없이 `(override, preferredLanguages)`만 받습니다.
- 워크스페이스 ID(`process-flow:workflow`)는 계속 `localStorage`에 둡니다.

### 서비스 이름 Process Flow (2026-11-14)

#### 변경

- 상단 바의 서비스 이름 자리표시(`[서비스 이름]`/`[Service name]`)를 서비스명 **Process Flow**로 바꿨습니다. `VITE_SERVICE_NAME`을 주면 그 이름을 씁니다. 서비스 이름은 번역하지 않습니다.
- 브라우저 탭 제목에 서비스 이름을 붙입니다(`개발 공정 관리 · Process Flow`, `Development process · Process Flow`).

### 재작업 요청 (2026-11-14)

이미 완료한 작업에서 나중에 문제를 발견했을 때, 그 작업부터 다시 할 수 있습니다. 뒤 작업은 앞 산출물을 이어받으므로, 중간 작업만 고치지 않고 그 작업부터 지금까지를 모두 재작업 대상으로 만듭니다.

#### 추가

- **재작업 요청**: 작업 뷰와 보드 상세에서 완료한 작업에 "재작업 요청"을 누르면, 범위(작업 n~m, 개수)와 취소되는 단계 승인을 보여 주고 사유를 받습니다. 사유는 필수입니다.
- **표시**: 재작업 대상은 "재작업 중 / 재작업 대기 / 잠김 · 재작업" 배지로 구분하고, 화면 위쪽 배너에 범위와 사유를 보여 줍니다. 상태 값(`done / doing / todo / locked`)은 그대로이고, 재작업 여부는 별도 표시입니다.
- **규칙**: 재작업도 앞에서부터 순서대로 다시 완료하고, 단계를 넘을 때 다시 승인을 받습니다. 범위를 모두 다시 완료하면 재작업이 끝납니다. 재작업 중에 더 앞 작업을 재작업하면 범위가 넓어집니다. 작업 기록(링크·메모)은 지우지 않습니다.
- **API·저장소**: 명령 `requestRework {taskId, reason}`, 응답 `rework`, 이벤트 `reworkRequested`·`reworkCompleted`, 규칙 위반 `reworkNotDone`·`reworkReasonRequired`. `workflow` 테이블에 `rework_until`·`rework_reason`을 추가했습니다(예전 데이터는 재작업 없음으로 읽습니다).

### 작업 순서 강제, 단계 승인, 마지막 완료만 취소 (2026-11-14)

단계·작업·보드 세 모드가 같은 규칙을 따릅니다. 진행 상태를 완료 집합 대신 진행 위치 하나(합 타입 `Phase`)로 바꿔, 규칙에 어긋난 상태는 아예 만들 수 없게 했습니다.

#### 변경

- **순서대로만 완료**: 단계 안에서도 앞 작업을 마쳐야 다음 작업을 완료할 수 있습니다. 차례가 아닌 작업의 체크박스·버튼은 비활성이고 이유("먼저 작업 n을 완료하세요")를 알려 줍니다. 작업 상태 배지는 완료 / 지금 차례 / 대기 / 잠김입니다.
- **단계 사이 승인**: 단계의 작업을 모두 마치면 자동으로 열리지 않고 "승인 대기"가 됩니다. "승인하고 다음 단계 열기"로 다음 단계를 엽니다(마지막 단계는 승인 없이 공정 완료).
- **완료 취소는 마지막으로 완료한 작업만**: 다음 단계에서 아직 아무것도 하지 않았다면 앞 단계의 마지막 작업 취소가 그 단계의 승인도 취소하고, 화면에 경고를 보여 줍니다. 작업 뷰에 "완료 취소" 버튼을 추가했습니다.
- **API**: 명령 `toggleTask`·`advanceStage`를 `completeTask`·`reopenTask`·`approveStage`로 바꿨습니다(`completeAndNext`는 유지). 응답에 `phase`를 추가했고, 이벤트 `stageUnlocked`를 `stageApproved`·`approvalRevoked`로 바꿨습니다. 규칙 위반 `outOfOrder`·`notLastCompleted`를 추가했습니다. 워크플로 목록 항목은 `unlockedStage`·`doneCount` 대신 `phase`를 줍니다.
- **저장소**: `workflow` 테이블에 `phase_kind`·`phase_stage`·`phase_completed`를 추가했습니다. 서버가 시작할 때 예전 형식(`unlocked_stage` + `done`)을 옮깁니다. 공정 순서의 앞에서부터 이어지는 완료만 인정하고, 예전에 열려 있던 단계보다 앞 단계는 승인된 것으로 봅니다.

### 언어·테마와 마지막 뷰·작업을 워크스페이스에 저장 (2026-11-14)

새로고침하거나 다른 브라우저에서 같은 워크스페이스(`?workflow=`)를 열어도 언어·테마, 마지막으로 연 뷰와 선택한 작업이 복원됩니다.

#### 추가

- **백엔드**: `GET`/`PATCH /api/v1/workflows/{workflowId}/preferences` (`locale`, `theme`, `view`, `selectedTaskId`).
  - PATCH는 준 항목만 바꾸고, 진행 상태의 `version`(낙관적 잠금)과 무관하게 항목별로 마지막 값이 이깁니다.
  - 허용값 밖의 값이나 공정에 없는 작업은 400입니다.
  - 저장소는 SurrealDB `workflow_preferences` 테이블(포트 `PreferencesRepository`, 어댑터 `SurrealPreferencesStore`). CORS에 `PATCH`를 추가했습니다.
- **프런트엔드**: 워크플로를 열 때 설정을 함께 불러와 뷰·선택 작업·언어·테마를 맞추고, 바뀐 항목만 직렬로 합쳐 저장합니다.
  - 단계 열기처럼 진행 명령이 선택 작업을 바꿔도 저장됩니다.
  - 설정 저장 실패는 편집을 막지 않습니다. `localStorage`는 새로고침 직후 깜빡임을 줄이는 캐시로 남습니다.
  - 서버 값이 오기 전에 사용자가 직접 바꾼 언어·테마는 서버 값으로 덮어쓰지 않습니다.

### 프런트엔드: core/web 워크스페이스와 클린 아키텍처로 구조 개편 (2026-11-14)

`frontend/`를 npm workspaces 모노레포로 바꾸고, 순수 코드와 부수효과 코드를 패키지·계층으로 나눴습니다.
화면 동작은 바뀌지 않았습니다(기존 통합 테스트가 그대로 통과).

#### 변경

- **패키지 분리**
  - `packages/core`(`@process-flow/core`): 공정 모델, 진행 규칙(리듀서·셀렉터), 표시 설정 규칙. React·DOM·브라우저 API에 의존하지 않습니다.
  - `apps/web`(`@process-flow/web`): React + Fluent UI 앱. `application`(Provider·포트·뷰모델) / `adapters`(브라우저 구현) / `ui`(화면) 계층으로 나눴습니다.
  - 도구(TypeScript, ESLint, Prettier, Vitest)는 워크스페이스 루트에서 한 번에 실행합니다. 스크립트 이름은 그대로입니다.
- **코어: 공정을 인자로 받기**
  - `STAGES`·`TASKS` 전역 상수에 묶여 있던 리듀서·셀렉터가 공정(`Process`)을 인자로 받습니다. `workflowReducer` → `createWorkflowReducer(process)`.
  - 다른 공정도 `defineProcess({ stages })`로 만들어 같은 규칙으로 진행할 수 있습니다(빈 단계, 중복 ID는 예외).
- **공정 문구를 ID로 연결**
  - 작업 ID가 위치 기반(`"0-3"`)에서 의미 있는 ID(`"requirements"`)로 바뀌었습니다. 단계에도 ID(`"planning"` 등)를 붙였습니다.
  - 한국어 원문(`domain/process.ts`)과 영어 번역(`i18n/processText.ts`)이 배열 순서로 맞물려 있던 것을, 언어별 사전 `STANDARD_PROCESS_TEXT`를 ID로 찾도록 바꿨습니다. 사전 키가 ID 유니온 타입이라 번역 누락·오타가 타입 검사에서 걸립니다.
- **부수효과를 포트와 어댑터로**
  - `localStorage`, `matchMedia`, `navigator.languages`, `<html lang>`, `document.title` 접근을 `adapters/browser/browserPlatform.ts`로 모았습니다.
  - `application/ports.ts`에 `PreferencesStore`, `ColorSchemeSource`, `DocumentSurface`, `Platform`을 정의했습니다. `App`은 `platform` prop으로 받고, `main.tsx`만 브라우저 구현을 만듭니다.
  - 설정 직렬화·초기값 결정(`parsePreferences`, `initialPreferences`, `resolveMode`)은 코어의 순수 함수가 됐습니다.
  - 시스템 테마 구독은 `useSyncExternalStore`로 바꿨습니다.
  - 환경 변수는 `main.tsx`에서만 읽고 `config.ts`(`parseConfig`)로 `AppConfig`를 만듭니다.
- **뷰모델**
  - 세 뷰와 스테퍼에 있던 "어떤 버튼을 내고, 왜 막혔는지" 판단을 `application/viewModels/`의 순수 함수로 옮겼습니다. 뷰는 결과(kind·숫자)를 문구로 바꾸고 `dispatch(action)`만 합니다.
- **경계 강제**
  - 코어 tsconfig에 DOM lib를 넣지 않아 브라우저 API를 쓰면 컴파일 오류가 납니다.
  - 코어 `package.json`의 `exports`로 공개 진입점(`src/index.ts`)만 열었습니다.
  - ESLint가 계층별 금지 import·전역을 검사합니다(예: `ui/`에서 `adapters/` 가져오기, 코어에서 `Math.random`·`Date.now`).
- **실행 경로**
  - 빌드 결과가 `frontend/dist/`에서 `frontend/apps/web/dist/`로, `.env.example`이 `frontend/apps/web/`으로 옮겨졌습니다.
  - `scripts/run-fe.sh`·`run-fe.ps1`과 `.claude/launch.json`을 새 경로에 맞췄습니다.

#### 테스트

- 총 61개(23개 추가). core는 Node 환경, web은 jsdom 환경에서 실행합니다.
  - 공정 정의 검증, 다른 공정에도 같은 규칙이 적용되는지, 모든 언어에 모든 ID의 문구가 있는지
  - 뷰모델: 단계 뷰 주 버튼·안내, 작업 뷰 주 버튼·안내, 측면 탐색 선택, 보드 열 안내
  - 브라우저 어댑터(localStorage·matchMedia·document), 환경 변수 변환
  - 통합 테스트는 가짜 Platform을 넣어 저장·문서 언어·제목·운영체제 모드 변경을 확인합니다.

### 프런트엔드: 한국어/영어 전환과 시스템/라이트/다크 테마 전환 (2026-11-14)

목업 두 개(A: 헤더 메뉴, B: 설정 패널)를 비교한 뒤 **B안(설정 패널)** 으로 구현했습니다.

#### 추가

- **설정 패널** (`components/SettingsDrawer.tsx`)
  - 헤더 오른쪽 설정(톱니바퀴) 버튼을 누르면 오른쪽에서 `OverlayDrawer`가 열립니다.
  - 테마: 시스템 설정 사용 / 라이트 / 다크 중에서 고릅니다. 선택지마다 미리보기가 붙어 있고, 미리보기는 테마별 `FluentProvider`의 토큰으로 그려 색을 하드코딩하지 않았습니다. "시스템 설정 사용" 아래에는 운영체제의 현재 모드("지금은 라이트")를 함께 보여 줍니다.
  - 언어: 한국어 / English 중에서 고릅니다. 언어 이름은 그 언어 자체로 쓰고, 화면 언어로 쓴 이름을 옆에 덧붙입니다(예: "English · 영어").
  - 고르는 즉시 적용되며, 저장 버튼은 없습니다.
- **설정 저장과 초기값** (`preferences/`)
  - 고른 언어·테마를 `localStorage`(`process-flow:preferences`)에 저장해 다음 방문에도 유지합니다. 저장소를 쓸 수 없거나 값이 깨져 있어도 앱은 기본값으로 동작합니다.
  - 저장된 값이 없으면 브라우저 선호 언어 목록에서 처음 맞는 지원 언어로 시작하고, 지원 언어가 없으면 한국어로 시작합니다. 테마는 시스템 설정을 따릅니다.
  - 자동으로 감지한 값은 저장하지 않고, 사용자가 직접 고른 값만 저장합니다.
- **다국어** (`i18n/`)
  - 화면 문구 약 90개를 `messages.ts`로 옮겼습니다. `Messages` 타입이 두 언어에 같은 키를 강제합니다. 숫자가 들어가는 문구는 함수로 두어 언어별 어순과 영어 단·복수를 처리합니다.
  - 공정 내용(6단계·25개 작업의 이름, 설명, 산출물)의 영어 번역을 `processText.ts`에 추가했습니다. 한국어 원본은 `domain/process.ts`에 그대로 두어 도메인 로직은 바꾸지 않았습니다.
  - 언어를 바꾸면 `<html lang>`과 문서 제목도 함께 바뀝니다.

#### 변경

- `App`의 `themeMode` prop을 없애고 `initialPreferences`(`{ locale, theme }`)로 바꿨습니다(테스트·시연용 초기값).
- `VITE_SERVICE_NAME`·`VITE_PROJECT_NAME`이 비어 있을 때 보이는 자리표시도 언어를 따릅니다. 값을 준 이름은 번역하지 않습니다.

#### 수정

- 설정 패널과 보드 카드 상세 패널(`OverlayDrawer`)을 닫으면 키보드 포커스가 `body`로 빠지던 문제를 고쳤습니다. 이제 패널을 연 버튼으로 포커스가 돌아갑니다. 보드 상세 패널의 문제는 이번 작업 전부터 있던 것입니다.

#### 테스트

- 총 38개(11개 추가).
  - 언어 전환 시 화면 전체·공정 내용·문서 언어가 바뀌고 저장되는지
  - 테마 선택이 저장되고, 시스템 항목이 운영체제 모드를 보여 주는지
  - 저장된 설정으로 시작하는지
  - 패널을 닫으면 포커스가 설정 버튼으로 돌아가는지
  - 언어 감지, 저장소 읽기/쓰기, 깨진 값·저장소 오류 처리(`preferences.test.ts`)
  - 영어 번역의 단계·작업 수가 공정 정의와 같은지(`processText.test.ts`)
- 테스트 사이에 설정이 새지 않도록 `test/setup.ts`에서 매 테스트 후 `localStorage`를 비웁니다.

#### 기타

- 비교용 목업(`frontend/mockup.html`, `src/mockup/`)은 B안 구현 후 삭제했습니다.
- `frontend/README.md`의 구조, 테마·다국어 설명, Fluent 컴포넌트 대응표를 현재 코드에 맞게 고쳤습니다.

### 프런트엔드: Fluent 2 디자인 시스템 정렬 (2026-11-14)

`frontend/`의 웹 화면이 [Microsoft Fluent 2](https://fluent2.microsoft.design/) 지침을 더 충실히 따르도록 4단계로 정리했습니다.
도메인 로직(`src/domain`)과 상태 관리(`src/state`)는 바꾸지 않았습니다.

#### 변경

- **카드 표면을 Fluent `Card`로 교체** (`StageView`, `TaskView`, `BoardView`, `StageStepper`)
  - 직접 만든 `div` 카드(그림자 `shadow4`, 모서리 `borderRadiusXLarge`)를 `Card`로 바꿨습니다. 모서리, 패딩, 그림자는 Card의 `size`(small/medium/large)를 따르고, 고대비 모드 테두리도 함께 얻습니다.
  - 모서리가 8px에서 4px(`borderRadiusMedium`)로 바뀌어 화면이 조금 더 각지고 촘촘해졌습니다.
  - 기존 `<section>`·`<nav>`의 의미는 `role="region"`과 `aria-labelledby`, 그리고 `role="navigation"`으로 유지했습니다.
  - 보드 카드에는 `Card`의 `onClick`을 쓰지 않았습니다. 카드 전체가 포커스 그룹이 되어 안의 체크박스와 겹치기 때문입니다. Card는 표면만 맡고, 클릭은 안쪽 버튼이 받습니다.
- **상호작용 상태 추가** (보드 카드, 스테퍼 단계)
  - 마우스를 올렸을 때(hover)와 눌렀을 때(pressed)의 배경을 추가했습니다. 전환에는 모션 토큰 `durationFaster`와 `curveEasyEase`를 씁니다.
  - 선택된 보드 카드는 Fluent selected 배경과 브랜드색 테두리로 표시합니다.
  - 포커스 표시를 `createFocusOutlineStyle()`로 바꿨습니다. 이제 키보드로 이동할 때만 나타납니다.
- **잠김·비활성 표현을 Fluent 지침에 맞춤**
  - 이유가 있는 비활성 버튼은 `disabled` 대신 `disabledFocusable`을 씁니다. 키보드로 포커스할 수 있고, 툴팁과 스크린 리더 설명으로 이유를 알립니다. 새 컴포넌트 `components/DisabledReason.tsx`가 이를 맡습니다.
  - 스테퍼의 잠긴 단계는 `aria-disabled`로 포커스를 남기고, "N단계를 마치면 열립니다." 툴팁을 보여 줍니다.
  - 보드 상세 창의 완료 버튼 라벨을 동작("완료로 표시")으로 바꿨습니다. 잠긴 이유는 MessageBar와 툴팁으로 옮겼습니다.
  - 작업 뷰에서 잠긴 작업을 열면 이유 MessageBar를 함께 보여 줍니다.
  - 잠긴 카드의 `opacity: 0.72`를 Fluent Card의 disabled 표현(disabled 배경·테두리·글자 토큰)으로 바꿨습니다. 상세 창은 계속 열 수 있습니다.
  - 잠긴 항목의 글자색을 `colorNeutralForeground3`에서 `colorNeutralForegroundDisabled`로 바꿨습니다.
- **작업 뷰 측면 탐색을 `Tree`에서 `NavDrawer`(inline)로 교체**
  - `NavCategory` / `NavCategoryItem` / `NavSubItemGroup` / `NavSubItem` 구조를 씁니다. 배경은 Nav 기본값인 `colorNeutralBackground4`입니다.
  - 직접 그리던 선택 표시(왼쪽 3px 그림자, `aria-selected`)를 Fluent 선택 막대로 바꿨습니다. 스크린 리더에는 `aria-current="page"`로 알립니다.
  - 단계마다 상태 아이콘(완료, 진행 중, 잠김)을 Regular/Filled 쌍으로 붙였습니다.
  - 키보드: 목록 전체가 Tab 정지점 하나로 바뀌었습니다. 안에서는 화살표로 이동하고 Enter로 선택합니다. 잠긴 작업도 포커스는 받지만 선택되지는 않습니다.
  - 항상 열린 탐색이므로 화면을 바꿀 때마다 밀려 들어오는 애니메이션은 껐습니다(`surfaceMotion={null}`).
- **타이포그래피와 아이콘 정리**
  - 직접 지정하던 `fontSize`·`fontWeight`를 Fluent 타입 램프(`Body1Strong`, `typographyStyles.body1`/`body1Strong`)로 바꿨습니다.
  - `Text weight="semibold"`를 `Body1Strong`으로 통일했습니다.
  - 작업 뷰 제목(h2)을 `Title3`에서 `Subtitle1`로 바꿔 다른 화면과 맞췄습니다. 이전에는 프로젝트명(h1)과 크기가 같았습니다.
  - "이 단계의 산출물" 목록의 `✓`·`·` 문자를 Fluent 아이콘으로 바꿨습니다.

#### 수정

- 보드 카드의 포커스 링이 Card의 `overflow: hidden`에 잘려 보이지 않던 문제를 고쳤습니다. 이제 링을 Card 안쪽 -2px에 그립니다.
- 비활성 이유 툴팁을 조건부로 감싸면 버튼이 활성화될 때 다시 마운트되어 키보드 포커스를 잃던 문제를 고쳤습니다. 이제 Tooltip을 항상 두고 숨기기만 합니다.
- Nav 하위 항목의 선택 막대가 `NavSubItemGroup`의 `overflow: hidden`에 잘리던 문제를 우회했습니다. 그룹을 왼쪽으로 8px 넓혔습니다. 설치된 `@fluentui/react-nav` 9.4.10의 동작으로 보이며, 업스트림 버그인지는 확인하지 않았습니다.

#### 테스트

- `App.test.tsx`에 테스트 2개를 추가하고 1개를 수정했습니다(총 27개).
  - 잠긴 스테퍼 단계가 포커스를 받고 이유를 설명하지만, 이동하지는 않는지 확인합니다.
  - 작업 뷰 Nav에서 작업을 고를 수 있고, 잠긴 작업은 이유만 알리는지 확인합니다.
  - 다음 단계 열기 버튼: `toBeDisabled()` 대신 `aria-disabled`와 설명을 확인하고, 활성화된 뒤에도 같은 요소가 유지되는지 확인합니다.

#### 기타

- 미리보기용 `.claude/launch.json`을 추가했습니다(시연 상태, 5179 포트).
