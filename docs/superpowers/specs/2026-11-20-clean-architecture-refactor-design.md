# Process Flow의 순수 코어와 실행 경계 리팩토링 설계

## 목표와 선택한 접근

기존 npm workspace와 Cargo workspace를 유지하면서 DDD의 업무 경계, DCI의 역할과 협력, 함수형 코어, ADT 상태 머신을 일관되게 적용한다. 현재 동작을 보존하고 규칙을 계산하는 코드와 계산 결과를 실행하는 코드를 분리한다.

사용자는 기존 workspace를 유지하고 업무별 Context, 순수 전이, 효과 실행 경계를 강화하는 접근을 선택했다. 업무별 독립 패키지로 전면 분할하는 대안은 패키지와 연결 코드가 크게 늘어나므로 채택하지 않았다. 새 프레임워크, 이벤트 소싱, 마이크로서비스는 도입하지 않는다.

이 문서는 구현 전 검토할 설계다. 업무 경계와 호환성 기준은 고정하고, 세부 파일명과 작은 함수 분할은 구현자가 결정한다.

## 현재 구조와 확인한 문제

프런트엔드는 `frontend/apps/web`과 `frontend/packages/{domain,application,runtime,adapter-http,adapter-browser,react,ui}`로 구성되어 있다. 백엔드는 `backend/apps/server`와 `backend/crates/{core,adapters,runtime,testing}`로 구성되어 있다. 루트 `mise.toml`이 두 workspace의 실행과 검사를 묶는다.

이미 프런트엔드 `domain/workflow/phase.ts`와 백엔드 `domain/src/workflow/phase.rs`에 진행 상태 ADT가 있다. 백엔드 `workflow::decide`는 상태와 이벤트를 반환하는 순수 함수이며, `application::workflow_policy::plan_command`도 순수하다. 이 구조는 유지한다.

| 위치                                                                                                   | 확인한 책임 혼합                                                                                   | 변경 방향                                                    |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `frontend/packages/runtime/src/workflow/workflowSession.ts`                                            | 상태, 저장 큐, 초안 복원, 권한 상실, 재조회, 설정 저장, 타이머 판단과 실행이 한 클래스에 집중된다. | 업무별 순수 전이와 작은 실행기로 분리한다.                   |
| `frontend/packages/react/src/auth/AuthProvider.tsx`                                                    | 인증 상태와 요청 순서, 초기 설정 충돌, 세션 만료를 React 내부에서 판단한다.                        | 인증 Context의 ADT와 전이 함수를 application으로 옮긴다.     |
| `frontend/packages/react/src/projects/ProjectsProvider.tsx`                                            | 프로젝트 조회, 멤버 조회와 워크플로 전환 정책이 섞여 있다.                                         | 조회와 전환 Context를 분리한다.                              |
| `frontend/packages/ui/src/pages/ProjectsPage.tsx`                                                      | 프로젝트 생성, 변경, 보관, 삭제와 워크플로 시작을 화면에서 저장소에 직접 요청한다.                 | 화면은 유스케이스의 명령과 조회 결과만 사용한다.             |
| `frontend/packages/ui/src/pages/UsersPage.tsx`                                                         | 사용자 변경과 비밀번호 변경의 순서를 화면이 조율한다.                                              | 사용자 관리 Context로 옮긴다.                                |
| `frontend/packages/ui/src/components/ProjectMembers.tsx`                                               | 멤버 조회, 추가, 권한 변경, 제거를 화면에서 직접 수행한다.                                         | 멤버 관리 Context로 옮긴다.                                  |
| `frontend/packages/react/src/projects/ProjectsProvider.tsx`, `runtime/src/workflow/workflowSession.ts` | 일부 조회와 설정 저장 오류를 `catch(() => undefined)`로 소거한다.                                  | 종류가 있는 실패 결과와 재시도 가능한 상태로 표현한다.       |
| `backend/crates/runtime/src/use_cases/auth.rs`                                                         | 실패 횟수, 시간 창, 세션 갱신 판단과 Mutex, 해시, 저장소 실행이 섞여 있다.                         | 판단은 순수 정책으로, 잠금과 실행은 runtime 경계로 분리한다. |
| `backend/crates/core/domain/src/workflow/state.rs`                                                     | 증빙 종류와 검토 상태가 문자열이며 증빙마다 관계없는 선택 필드를 보유할 수 있다.                   | 내부 도메인 모델을 enum과 판별 유니온으로 바꾼다.            |
| `backend/crates/core/domain/build.rs`                                                                  | 빌드 과정에서 프런트엔드 도메인 내부 JSON을 상대 경로로 읽는다.                                    | 공통 계약 데이터와 독립 생성 도구로 대체한다.                |

분석 기준 검사에서 프런트엔드 `npm run check`는 통과했고 테스트 203개 통과, 1개 건너뜀이다. 백엔드 `cargo test --workspace --locked`도 통과했다. 백엔드에는 기존 macOS 링커의 unwind 크기 경고가 있다.

## 업무 경계와 DCI 모델

DDD의 경계는 기존 계층 패키지 안의 업무별 모듈로 표현한다. 단순 파일 재배치로 끝내지 않고 공개 타입과 함수가 해당 업무의 언어를 드러내도록 한다.

| 업무 경계         | Data                                              | Context와 역할                                       | Interaction                                    |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| 공정 정의         | Process, Stage, Task, TaskForm                    | 공정 정의자, 공정 조회자                             | 공정 검증, 작업 순서와 입력 요구사항 조회      |
| 워크플로 진행     | Workflow, Phase, Rework, TaskRecord               | 작업 실행자, 단계 승인자, 기록 작성자, 재작업 요청자 | 명령 허용, 순수 진행 전이, 이벤트 생성         |
| 워크플로 동기화   | 서버 기준 상태, 화면 선택, 미저장 명령, 복구 초안 | 명령 제출자, 저장 결과 수신자, 초안 복구자           | 순차 저장, 응답 조정, 충돌 보존, 재조회와 전환 |
| 프로젝트와 멤버십 | Project, Membership, Assignments                  | 프로젝트 관리자, 멤버 관리자, 배정 관리자            | 생성, 변경, 보관, 멤버 변경, 배정 해제 계획    |
| 인증과 사용자     | User, Session, 로그인 시도 상태                   | 로그인 시도자, 인증된 사용자, 사용자 관리자          | 초기 설정, 로그인, 만료, 갱신, 비밀번호 변경   |
| 내 작업과 검색    | WorkItem, 검색 조건과 결과                        | 업무 조회자, 기록 검색자                             | 접근 가능한 데이터에서 조회 모델 계산          |

DCI 역할은 `owner/editor/viewer` 접근 권한과 구별한다. 같은 사용자가 Context에 따라 작업 실행자 또는 단계 승인자 역할을 수행한다. 프런트엔드에서 계산한 역할은 화면 제어에만 사용하고, 서버는 요청마다 권한과 담당 배정을 다시 검증한다.

Data에는 저장소, HTTP, React, 타이머, 구독을 넣지 않는다. Context는 필요한 데이터와 역할을 명시적으로 받아 협력에 필요한 입력을 구성한다. Interaction은 그 입력과 명령으로 다음 상태, 도메인 이벤트, 실행 계획을 계산한다. 역할의 런타임 주입, 엔터티 monkey patching, 상속 계층은 도입하지 않는다. TypeScript의 readonly 구조 타입과 Rust의 작은 구조체 및 enum을 사용한다.

## 의존 방향과 workspace 구조

기존 패키지 이름과 실행 경로를 유지한다. 업무마다 domain과 application 패키지를 새로 복제하지 않는다.

```text
contracts/
  task-forms.json
tools/
  catalog/
frontend/
  apps/web/
  packages/
    domain/src/{process,workflow,assignment,...}
    application/src/
      contexts/{workflow,auth,projects,members,users,work}
      ports/
      viewModels/
    runtime/src/{workflow,auth,projects,members,users,work}
    adapter-http/
    adapter-browser/
    react/
    ui/
backend/
  apps/server/
  crates/
    core/domain/
    core/application/src/{contexts,ports,...}
    runtime/
    adapters/
    testing/
```

`contracts`의 JSON은 언어 중립적인 계약 데이터이며 실행 코드 패키지가 아니다. `tools/catalog`만 파일을 읽고 생성물을 쓴다. 두 도메인은 자기 패키지 안에 생성되어 버전 관리되는 정적 데이터만 사용한다. 생성물에는 주석을 추가하지 않는다. 생성 도구의 검사 모드는 두 생성물이 원본과 일치하는지 확인하며, 변경은 정상 생성 명령에서만 수행한다. Rust 도메인 `build.rs`와 해당 빌드 의존성을 제거한다.

프런트엔드 의존 방향은 다음과 같다.

```text
apps/web -> ui -> react -> runtime -> application -> domain
apps/web -> adapter-http / adapter-browser -> application / domain
ui -> application의 순수 뷰모델 / domain의 읽기 모델
```

UI는 저장소 포트 객체를 받지 않는다. React는 구독, 생명주기, 화면용 인터페이스 연결을 담당한다. runtime은 application의 유스케이스 계약을 구현하며 포트를 호출한다. 조립은 `apps/web`에서 수행한다. 화면 로컬 폼 입력, 펼침 상태, 포커스 같은 표현 상태는 UI와 React에 남긴다.

백엔드는 `server -> adapters/runtime -> application -> domain`을 유지한다. API와 DB의 DTO는 각각의 어댑터에 둔다. application은 도메인 타입, 포트, 순수 Context와 실행 계획을 공개한다. runtime은 필요한 포트만 주입받아 실행한다. 서비스 공개 메서드는 호환성을 유지하며 내부의 순수 판단을 Context로 위임한다.

## 상태 머신과 효과 실행

공통 전이 형태는 `transition(state, event, context) -> { state, effects }`이다. 도메인 진행 전이는 도메인 이벤트를 반환하고, application의 전이는 외부 실행을 위한 효과 설명을 반환한다. 효과는 콜백이나 Promise가 아닌 ADT 데이터다. 이 둘은 별도 타입이며 도메인이 저장 효과 타입을 참조하지 않는다.

runtime은 효과를 포트 호출로 해석하고, 성공 또는 실패를 다시 이벤트로 전달한다. `subscribe`, 메모리 상태 보관, 진행 중인 Promise 보관, 취소 핸들, 파일 및 네트워크 I/O는 runtime 또는 어댑터에만 존재한다. 지역 변수나 외부로 노출되지 않는 컬렉션을 계산 중 갱신하는 것은 허용하되 입력과 공유 상태를 변경하지 않는다.

### 워크플로 동기화

화면 선택 상태와 서버에 저장되는 업무 상태를 타입으로 구분한다. 기존 `WorkflowState` 소비자를 위한 투영 함수를 제공해 화면을 한 번에 다시 작성하지 않는다.

독립적으로 변하는 상태를 하나의 거대한 유니온으로 묶지 않는다. 서버 동기화, 설정 저장, 배정 저장은 각자의 ADT를 가진다. 서버 동기화의 상태는 다음을 구별한다.

- Loading: 로드 요청 식별자와 보존할 초안 또는 이전 상태.
- Empty: 사용할 워크플로가 없음.
- Ready: 저장된 워크플로, 화면 선택, 복구 초안.
- Saving: 서버 기준 상태, 낙관적 상태, 비어 있지 않은 명령 큐, 전송 중 명령.
- Failed: 오류 종류, 복구에 필요한 서버 기준 상태와 미저장 명령. 최초 로드 실패와 저장 실패는 별도 variant로 구별한다.

주요 이벤트는 열기, 열기 성공과 실패, 사용자 명령, 저장 시점 도달, 저장 성공과 실패, 재조회, 초안 복원, 권한 갱신이다. 효과는 로드, 명령 실행, 저장 예약과 취소처럼 의미가 분명한 데이터다. 초기 로드 이벤트에는 서버가 반환한 워크플로 ID도 포함한다.

요청 식별자는 순수하게 증가하는 세대 번호와 명령 번호로 만든다. 이전 워크플로 또는 이전 요청에서 늦게 도착한 응답은 현재 상태에 적용하지 않는다. 런타임은 동시에 하나의 진행 명령만 제출한다. 전송 중인 명령은 후속 기록 편집과 병합하지 않는다.

기록 편집의 500ms 지연, 작업 완료 전 미전송 기록 검사, 버전 기반 저장, 화면 선택 보존, 저장 확인 후 워크플로 전환을 유지한다. 충돌이나 권한 상실 시 미저장 기록을 지우지 않는다. 설정 저장 실패는 진행 저장 실패와 구별하고, 실패한 패치를 보존해 명시적으로 재시도할 수 있게 한다. 진행 명령은 오류 이후 자동으로 재전송하지 않는다.

`WorkflowSession`은 외부 소비자를 위한 호환 인터페이스를 유지할 수 있지만, 순수 정책을 소유하지 않는다. 구독과 실행만 위임하는 얇은 경계로 축소한다.

### 인증과 관리 업무

인증의 Loading, SetupRequired, SignedOut, Authenticating, SignedIn, Unavailable과 세션 만료 이벤트를 application에서 정의한다. 로그인 입력의 비밀번호는 요청에 필요한 동안만 보유하고 공개 스냅샷과 지속 상태에 보관하지 않는다. 저장소의 성공과 실패는 ADT 이벤트로 변환한다. 서버 로그아웃 실패를 성공으로 소거하지 않고 호출자에게 실패를 전달한다. 만료된 세션은 로그인 화면으로 전환한다.

프로젝트, 멤버, 사용자 조회와 변경도 조회 상태와 작업 결과를 구별한다. 사용자 정보 변경 성공 후 비밀번호 변경 실패와 같은 부분 성공을 명시적으로 전달하고 이미 성공한 변경을 실패로 되돌려 표시하지 않는다. 화면의 기존 성공 및 오류 문구는 유지하며, 새로 드러나는 실패에는 한국어와 영어 문구를 함께 제공한다.

Rust 인증에서는 현재 시각, 설정, 실패 기록으로 차단 여부와 다음 실패 기록을 계산하는 순수 함수를 추출한다. Mutex와 저장소 접근은 runtime에 남긴다. 만료와 갱신 시점 판단도 순수 계산으로 추출하되 비밀번호 해싱, 더미 해시 검증, 토큰 발급과 세션 저장의 순서 및 보안 성질을 유지한다. 마지막 관리자와 마지막 소유자 보존의 기존 순수 규칙을 재사용한다.

## 도메인 ADT와 어댑터 매핑

검토 상태는 Pending, Passed, Blocked로 표현한다. 증빙은 LinkEvidence와 FileEvidence의 합 타입으로 표현해 링크에 파일 바이트가 붙거나 파일에 URL이 붙는 내부 상태를 막는다. TypeScript에서는 판별 유니온, Rust에서는 enum을 사용한다.

HTTP JSON과 SQLite JSON의 기존 필드명, 문자열 값, 선택 필드, 이벤트 스냅샷을 유지한다. 어댑터에서 외부 DTO를 검증하고 내부 ADT로 변환한다. 기존에 409 `ruleViolation`으로 처리하던 잘못된 기록을 단순 enum 역직렬화 실패인 400으로 바꾸지 않는다. 명령 DTO 변환 실패를 기존 업무 오류로 매핑한다. DB의 잘못된 저장 값은 기존 저장소 손상 오류 경로로 처리한다. 정상 데이터에는 DB 마이그레이션이 필요하지 않다.

## 경계 강제와 검사

프런트엔드 ESLint와 TypeScript 경계를 확장한다. 순수 계층의 허용 의존성, 외부 부수효과 API, 패키지 공개 진입점, UI의 저장소 접근 금지를 검사한다. 계층별 금지 규칙을 간단한 잘못된 입력 예제로 검증해 설정만 존재하고 작동하지 않는 상황을 막는다.

백엔드는 Cargo metadata에서 내부 크레이트 의존 방향과 domain의 일반 및 빌드 의존성을 검사한다. Clippy의 순수 계층 금지 규칙을 유지하고, 도메인 빌드에서 프런트엔드 파일 접근을 제거한다. 공통 계약의 생성물 일치 검사와 함께 루트 mise의 check에 연결한다. 기존 셸과 PowerShell 실행 경로도 유지한다.

필수 검증은 다음과 같다.

1. 순수 전이 테스트: 정상 진행, 잘못된 상태와 이벤트, 오류 전이, 입력 불변성, 멱등성, 역할과 권한, 빈 큐와 비어 있지 않은 큐의 불변식.
2. 동기화 실행 테스트: 지연 저장, 한 번에 한 명령, 저장 중 편집 병합, 충돌 복구, 권한 상실, 늦은 응답, 구독 해제와 취소, 실패한 설정 패치 보존.
3. UI 통합 테스트: 인증, 프로젝트, 사용자, 멤버, 배정, 내 작업, 문서와 증빙, 미저장 상태에서 전환과 복구.
4. 어댑터 계약 테스트: 기존 API와 저장 JSON 왕복, 오류 코드, 이벤트 내용, SQLite 영속성, 검색 색인 복원.
5. 전체 검사: 프런트엔드 check와 build, 백엔드 fmt와 clippy 및 전체 workspace 테스트, workspace 의존성 검사, 계약 생성물 일치 검사.

필요한 행동 테스트를 먼저 실패시키고 구현한다. 순서 교환 등 되돌리기 쉬운 단순 표현 변경을 위한 구현 복제 테스트는 추가하지 않는다.

## 구현 순서와 완료 기준

기존 동작의 회귀 테스트를 기준으로 다음 순서로 전환한다. 각 단계는 연결 지점까지 실제로 교체하며 사용되지 않는 대체 구조를 남기지 않는다.

1. 공통 계약 데이터 생성 경계를 분리하고 workspace 검사에 연결한다.
2. 문서 검토와 증빙의 내부 ADT를 도입하고 HTTP와 SQLite 매핑을 보존한다.
3. 워크플로 역할 Context와 순수 동기화 전이를 도입하고 기존 session을 실행기로 축소한다.
4. 인증과 프로젝트, 멤버, 사용자, 내 작업의 정책 및 실행을 UI와 React에서 분리한다.
5. Rust 인증과 관리 유스케이스의 순수 판단을 Context로 추출하고 포트를 업무별 모듈로 정리한다. 기존 공개 경로는 재수출로 유지한다.
6. 경계 검사를 강화하고 문서 및 전체 통합 검증을 완료한다.

이전 요청에서 수정한 breadcrumb와 뒤로가기 배치를 보존한다. API와 정상 저장 데이터의 의미, 권한 규칙, 작업 진행 및 재작업 규칙을 유지한다. 기존 마지막 소유자 및 마지막 관리자 변경의 트랜잭션 원자성 한계를 이 구조 리팩토링으로 해결했다고 주장하지 않는다. 해당 동작을 변경하는 별도 기능은 포함하지 않는다.

완료 시 domain과 application에는 실행 부수효과가 없고, UI와 React에는 업무 실행 순서와 저장소 호출이 없으며, runtime은 명시적인 포트와 전이 결과를 실행한다. 순환 의존성과 패키지 경계를 넘는 상대 import가 없어야 한다. 소스 코드에 설명 주석을 추가하지 않는다. 모든 새 구조는 실제 애플리케이션에서 사용되고, 전체 검사가 통과해야 한다.
