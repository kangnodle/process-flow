# process-flow backend

`frontend/`의 6단계 공정 앱을 위한 Rust와 Actix Web API 서버입니다.
SQLite가 업무 데이터의 원본을 저장하고 LanceDB가 작업 기록의 벡터 검색을 담당합니다.

## 시작하기

Rust 1.98.0과 Protocol Buffers 컴파일러 `protoc`가 필요합니다. `protoc`가 PATH에 없다면 `PROTOC`에 실행 파일 경로를 지정합니다. LanceDB의 첫 빌드는 Arrow와 DataFusion 의존성을 함께 컴파일합니다. 메모리가 제한된 환경에서는 `CARGO_BUILD_JOBS=1`을 사용합니다.

개발·테스트 빌드는 [Cargo의 의존성 프로필 재정의](https://doc.rust-lang.org/cargo/reference/profiles.html#overrides)로 외부 크레이트에 `opt-level = 1`을 적용하고, unwind 테이블이 가장 큰 `lance`에는 크기 최적화 `opt-level = "z"`를 적용합니다. LanceDB·Arrow·DataFusion의 코드와 unwind 테이블을 줄여 macOS 링커의 `__eh_frame` 16 MiB 제한에 대응합니다. workspace 크레이트는 최적화 없이 빌드하며 줄 번호 디버그 정보, 디버그 단언, 정수 오버플로 검사와 panic unwinding을 유지합니다. 외부 의존성의 최초 컴파일은 더 오래 걸리고 최적화된 의존성 내부의 디버거 실행 순서는 달라질 수 있습니다.

```bash
cd backend
cargo run
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

기본 주소는 `http://127.0.0.1:8080`입니다. 설정은 환경 변수로 지정하며 [`.env.example`](.env.example)에 기본값이 있습니다. `.env` 파일은 자동으로 읽지 않습니다.

```bash
SQLITE_URL=sqlite://data/process-flow.sqlite3 LANCEDB_URI=data/search.lancedb cargo run
```

SQLite는 파일에, LanceDB는 별도 디렉터리에 저장합니다. 상대 경로는 실행 디렉터리 기준입니다. 서버를 다시 시작할 때 같은 경로를 사용하세요. 기존 SurrealKV 디렉터리는 새 저장소로 열거나 자동 변환하지 않습니다.

일회용 업무 데이터는 `SQLITE_URL=sqlite::memory:`로 실행할 수 있습니다. 검색 색인에도 별도의 임시 `LANCEDB_URI`를 지정하세요. `scripts/dev.sh be --mem` 또는 `scripts/dev.ps1 be -Mem`은 메모리 SQLite와 실행마다 분리된 임시 검색 디렉터리를 사용하고 종료 시 검색 디렉터리를 정리합니다. 로컬 저장소 조합당 서버 프로세스 하나를 지원하며, 여러 HTTP 워커는 같은 프로세스 안에서 실행합니다. SQLite 또는 LanceDB 경로가 다른 서버나 관리 명령에서 사용 중이면 OS 파일 잠금으로 시작을 거부합니다. 잠금 파일은 남아 있어도 프로세스가 끝나면 잠금은 해제됩니다.

문서 양식의 원본은 루트 `contracts/task-forms.json`입니다. `node tools/catalog/generate.mjs`로 두 언어의 정적 데이터를 생성하고 `--check`로 일치를 검사합니다. Rust 도메인 빌드는 프런트엔드 파일이나 JSON 파서에 의존하지 않습니다.

문서 답변과 증빙은 작업 기록과 같은 버전과 트랜잭션으로 저장합니다. 파일은 인증된 기록의 base64이며 파일당 2 MiB, 워크플로당 디코딩 후 총 8 MiB, 작업당 증빙 20개, HTTP JSON 16 MiB 제한을 유지합니다. 감사 이벤트에는 실행자, 시간, 문서와 증빙 스냅샷이 남습니다.

## 구조와 저장 경계

Cargo workspace의 의존성은 바깥에서 안쪽으로 향합니다.

```text
apps/server → adapters/api → runtime → core/application → core/domain
            → adapters/sqlite → core/application
            → adapters/lancedb → core/application
            → adapters/process-cache, security, embedding, system
```

`core/domain`은 순수한 공정·문서·진행·배정·권한 규칙을 정의합니다. `core/application`은 순수 정책과 저장소·시계·임베딩 포트를 정의합니다. `runtime`은 주입된 포트를 호출하며 유스케이스와 검색 동기화를 실행합니다. SQLx와 Arrow, LanceDB 타입은 인프라 어댑터와 서버 조립 경계에만 있습니다.

`core/application/contexts`는 인증, 사용자, 멤버십, 워크플로의 협력을 모델링합니다. 워크플로 역할은 작업 실행자, 단계 승인자, 기록 작성자, 재작업 요청자로 구분하며 권한 판단은 도메인 규칙을 공유합니다. 로그인 실패 횟수와 세션 갱신 시점은 전달받은 시각으로 계산하고 잠금·해싱·저장은 runtime이 실행합니다.

문서 검토 상태와 링크·파일 증빙은 도메인 enum으로 표현합니다. API와 SQLite 어댑터의 DTO가 기존 JSON 형식으로 변환하므로 정상 저장 데이터의 마이그레이션은 필요하지 않습니다.

| 패키지                               | 역할                                                           |
| ------------------------------------ | -------------------------------------------------------------- |
| `process-flow-adapter-sqlite`        | 업무 저장소, 버전 SQL 마이그레이션, 검색 원본과 내구성 있는 큐 |
| `process-flow-adapter-lancedb`       | 벡터 문서 저장, 코사인 검색, 검색 색인 메타데이터              |
| `process-flow-adapter-process-cache` | 공정 조회 캐시                                                 |
| `process-flow-adapter-system`        | 시스템 시계, UUID, 저장소 OS 잠금                              |
| `process-flow-testing`               | 결정적인 메모리 포트와 서비스 조립                             |

SQLite에는 외래 키와 고유 제약을 적용하며 파일 DB는 WAL과 유한한 잠금 대기 시간을 사용합니다. 공정·단계·작업은 관계형 테이블에 순서를 저장하고 선행 작업은 앞선 단계의 작업을 번호순으로 조회합니다.

## 검색 동기화와 복구

워크플로 저장은 SQLite에서 상태, 감사 이벤트, 검색 작업을 함께 커밋합니다. 검색 텍스트가 바뀌면 영속적인 새 개정을 발급합니다. 일반 진행 상태 변경만으로 검색 문서를 무효화하지 않습니다.

한 작업자가 큐를 읽고 트랜잭션 밖에서 임베딩을 생성하여 LanceDB에 반영한 뒤 SQLite 큐를 조건부로 완료 처리합니다. 두 DB에 걸친 원자적 커밋은 없습니다. LanceDB 쓰기 직후 프로세스가 종료되어도 같은 작업을 재실행할 수 있습니다. 실패한 작업은 1초부터 최대 256초의 간격으로 재시도하며, 다른 문서의 처리를 계속합니다. 업무 저장 성공은 SQLite 커밋을 의미합니다.

검색은 허용된 워크플로 범위로 후보를 제한하고 SQLite 원본의 존재·개정·본문과 대조합니다. 갱신·삭제된 원본의 이전 검색 문구는 반환하지 않습니다. 점수는 기존과 같은 코사인 유사도이며 양수인 결과를 최대 50개까지 반환합니다. 임베딩은 외부 호출 없는 해시 임베더와 기본 256차원을 유지합니다. 작은 데이터에서는 정확 벡터 검색을 사용합니다.

서버 시작 시 원본과 색인을 페이지 단위로 비교하고 이후 5분마다 반복합니다. 누락·불일치 문서와 원본이 없는 잔여 색인을 큐에 등록하며, 이미 대기 중인 작업의 재시도 시각을 초기화하지 않습니다. 색인 디렉터리가 없어도 SQLite에서 복원합니다. 초기 복원 중에는 검색 결과가 부분적일 수 있습니다. 개별 실패는 서버 경고 로그에서 확인할 수 있습니다.

차원이나 임베딩 버전이 기존 색인과 맞지 않으면 명시적으로 시작에 실패합니다. 서버를 중지한 뒤 아래 명령으로 새 색인을 재구축합니다.

```bash
cargo run -- --rebuild-search
```

재구축은 검색 경로 안의 임시 디렉터리에 색인을 생성하고 원본과 대조한 뒤 LanceDB가 소유한 `search_documents.lance` 테이블 디렉터리만 교체합니다. SQLite와 다른 파일의 경로는 유지합니다. SQLite를 테이블 디렉터리 내부에 둔 배치는 원본 보호를 위해 재구축 전에 거부합니다. 이전 테이블은 로그에 표시되는 `search_documents.lance.previous-…` 디렉터리에 보관합니다. 정상 종료는 진행 중인 색인 작업을 마친 뒤 저장소를 닫습니다. 강제 종료 시 미완료 작업은 다음 실행에서 재시도합니다.

## 새 데이터로 시작

기존 데이터 이관 없이 새 SQLite 저장소로 시작합니다. 처음 접속하면 관리자 계정을 설정하고 프로젝트와 워크플로를 새로 만듭니다. 기존 SurrealDB 데이터 디렉터리는 읽거나 변경하지 않습니다. 스냅샷 가져오기 명령은 제공하지 않습니다.

## 백업과 복원

SQLite 원본을 백업하면 검색 색인을 재생성할 수 있습니다. 실행 중에는 SQLite 온라인 백업이나 `VACUUM INTO`로 일관된 스냅샷을 만듭니다. WAL이 활성화된 DB의 본체 파일만 실행 중에 복사하지 마세요. 서버를 정상 종료한 뒤 저장소를 보관하는 방법도 가능합니다. LanceDB를 별도로 보관하려면 서버를 중지한 상태에서 디렉터리를 복사합니다.

복원한 SQLite를 지정하고 빈 검색 디렉터리로 재구축한 뒤 서버를 시작합니다. 같은 SQLite 원본을 공유하면서 LanceDB 경로만 다르게 하여 서버를 두 개 실행하는 구성도 지원하지 않습니다.

## API

JSON 필드는 camelCase입니다. 명령의 `type`은 프론트엔드 `WorkflowAction`의 이름과 같습니다.

`/health`와 `/api/v1/auth/*`를 뺀 모든 경로는 로그인이 필요합니다(없으면 401 `unauthenticated`). 아래 [인증](#인증)을 보세요.

| 메서드 | 경로                                                         | 설명                                               |
| ------ | ------------------------------------------------------------ | -------------------------------------------------- |
| GET    | `/health`                                                    | 상태 확인                                          |
| GET    | `/api/v1/processes/{processId}`                              | 공정 구조 (`standard`)                             |
| GET    | `/api/v1/processes/{processId}/tasks/{taskId}/prerequisites` | 선행 단계 작업 조회                                |
| GET    | `/api/v1/projects?includeArchived=`                          | 프로젝트 목록 (기본: 보관 제외)                    |
| POST   | `/api/v1/projects`                                           | 프로젝트 만들기 → 201                              |
| GET    | `/api/v1/projects/{projectId}`                               | 프로젝트 상세                                      |
| PATCH  | `/api/v1/projects/{projectId}`                               | 이름·설명 수정, 보관·보관 해제                     |
| DELETE | `/api/v1/projects/{projectId}`                               | 보관 (삭제 대신) → 200                             |
| GET    | `/api/v1/projects/{projectId}/workflows`                     | 프로젝트의 워크플로 목록                           |
| POST   | `/api/v1/projects/{projectId}/workflows`                     | 프로젝트에 워크플로 시작 → 201                     |
| GET    | `/api/v1/projects/{projectId}/members`                       | 프로젝트 멤버와 역할                               |
| PUT    | `/api/v1/projects/{projectId}/members/{userId}`              | 멤버 추가·역할 변경 (`{"role"}`)                   |
| DELETE | `/api/v1/projects/{projectId}/members/{userId}`              | 멤버 빼기 → 204                                    |
| GET    | `/api/v1/users?includeInactive=`                             | 사용자 목록 (기본: 비활성 제외)                    |
| POST   | `/api/v1/users`                                              | 사용자 만들기 → 201                                |
| GET    | `/api/v1/users/{userId}`                                     | 사용자 상세                                        |
| PATCH  | `/api/v1/users/{userId}`                                     | 이메일·이름 수정, 비활성화·되살리기                |
| DELETE | `/api/v1/users/{userId}`                                     | 비활성화 (삭제 대신) → 200                         |
| PUT    | `/api/v1/users/{userId}/password`                            | 비밀번호 지정 (관리자) → 204                       |
| GET    | `/api/v1/users/{userId}/projects`                            | 사용자가 속한 프로젝트와 역할                      |
| GET    | `/api/v1/me/work`                                            | 내 할 일 (배정·미배정·참고)                        |
| GET    | `/api/v1/auth/status`                                        | `{ setupRequired, user }` (로그인 없이 200)        |
| POST   | `/api/v1/auth/setup`                                         | 첫 관리자 만들기 → 201 + 세션 쿠키 (한 번만)       |
| POST   | `/api/v1/auth/login`                                         | 로그인 → 세션 쿠키                                 |
| POST   | `/api/v1/auth/logout`                                        | 로그아웃 → 204                                     |
| POST   | `/api/v1/auth/password`                                      | 자기 비밀번호 바꾸기 → 204                         |
| GET    | `/api/v1/workflows?projectId=`                               | 워크플로 목록                                      |
| POST   | `/api/v1/workflows`                                          | 워크플로 시작 → 201 (`projectId` 필수, 없으면 400) |
| GET    | `/api/v1/workflows/{workflowId}`                             | 상태 + 진행률                                      |
| POST   | `/api/v1/workflows/{workflowId}/commands`                    | 명령 실행                                          |
| GET    | `/api/v1/workflows/{workflowId}/assignments`                 | 담당 배정(RACI)                                    |
| PUT    | `/api/v1/workflows/{workflowId}/assignments`                 | 담당 배정 전체 바꾸기 (소유자)                     |
| GET    | `/api/v1/workflows/{workflowId}/preferences`                 | 화면 설정 조회                                     |
| PATCH  | `/api/v1/workflows/{workflowId}/preferences`                 | 화면 설정 일부 변경                                |
| GET    | `/api/v1/search/records?q=&workflowId=&limit=`               | 작업 기록 의미 검색 (벡터)                         |

```bash
curl -X POST localhost:8080/api/v1/workflows -H 'content-type: application/json' -d '{"name":"데모"}'

curl -X POST localhost:8080/api/v1/workflows/<id>/commands -H 'content-type: application/json' -d '{
  "expectedVersion": 0,
  "command": { "type": "completeAndNext", "taskId": "goals" }
}'
# → { "changed": true, "events": [{ "type": "taskCompleted", "taskId": "goals" }], "workflow": { "version": 1, ... } }
```

### 프로젝트

프로젝트 하나에 워크플로가 여러 개 있습니다(1:N). 워크플로 응답에는 `projectId`가 있고, 워크플로는 프로젝트를 옮기지 않습니다.

```bash
curl -X POST localhost:8080/api/v1/projects -H 'content-type: application/json' -d '{"name":"결제 개편","description":"2분기"}'
# → 201 { "id", "name": "결제 개편", "description": "2분기", "archived": false, "version": 0 }

curl -X PATCH localhost:8080/api/v1/projects/<id> -H 'content-type: application/json' -d '{"expectedVersion":0,"name":"결제 2.0"}'
curl -X POST localhost:8080/api/v1/projects/<id>/workflows -H 'content-type: application/json' -d '{"name":"웹"}'
```

- 이름은 앞뒤 공백을 지우고 1~100자, 설명은 2000자까지입니다.
- **삭제하지 않고 보관합니다.** 워크플로·이벤트 로그·검색 색인이 프로젝트를 가리키기 때문입니다. `DELETE`나 `PATCH {"archived": true}`로 보관하고, `PATCH {"archived": false}`로 되돌립니다. 보관한 프로젝트의 기존 워크플로는 열람만 할 수 있습니다. 새 워크플로 시작은 409 `conflict`, 기존 워크플로의 진행·기록·담당 배정·공유 화면 설정 변경은 403 `forbidden`을 반환합니다.
- **기본 프로젝트는 없습니다.** 서버를 처음 띄우면 프로젝트도 워크플로도 없고, 워크플로는 사용자가 만든 프로젝트 안에서만 시작합니다. 프로젝트가 없던 예전 워크플로가 남아 있으면, 그때만 서버가 시작할 때 보통 프로젝트 "이전 워크플로"를 하나 만들어 그리로 옮깁니다. 예전에 만들어진 `project:default`는 이제 보통 프로젝트라 보관할 수 있습니다.

### 인증

```bash
# 관리자가 없을 때 한 번만: 첫 관리자를 만들고 세션 쿠키를 받습니다.
curl -c cookies.txt -X POST localhost:8080/api/v1/auth/setup -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","name":"관리자","password":"<8자 이상>"}'
# 그 뒤에는 로그인합니다. 이후 요청에는 -b cookies.txt 를 붙입니다.
curl -c cookies.txt -X POST localhost:8080/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"<비밀번호>"}'
```

- **첫 가입자가 관리자입니다.** 활성 관리자가 한 명도 없으면 `POST /auth/setup`이 열려 있고, 처음 요청한 사람이 관리자가 됩니다(그 뒤에는 409 `conflict`). 그래서 밖에서 닿는 주소로 띄울 때는 초기 설정을 먼저 마쳐야 합니다. 서버는 시작할 때 관리자가 없으면 경고를 남깁니다.
- 인증이 생기기 전에 만든 사용자는 비밀번호가 없어 로그인할 수 없습니다. 초기 설정에 그 사용자의 이메일을 쓰면 그 레코드가 관리자가 되고, 나머지는 관리자가 `PUT /users/{userId}/password`로 비밀번호를 정해 줍니다.
- 비밀번호는 8~128자이고 argon2id 해시로 `credential` 테이블에 따로 저장합니다. 사용자 응답에는 나오지 않습니다.
- 세션 토큰은 `HttpOnly`·`SameSite=Lax` 쿠키(`pf_session`)로만 오가고, DB에는 SHA-256 다이제스트만 남습니다. 마지막으로 쓴 뒤 `SESSION_TTL_HOURS`(기본 168시간)가 지나면 끝납니다. HTTPS로 서비스할 때는 `COOKIE_SECURE=true`로 `Secure`를 붙입니다.
- 로그인 실패는 계정이 없든 비밀번호가 틀리든 같은 401 `invalidCredentials`입니다. 한 이메일이 15분 안에 10번 실패하면 그 15분이 끝날 때까지 429 `tooManyAttempts`입니다(횟수는 프로세스 메모리에만 둡니다).
- **관리자(`isAdmin`)만** 사용자를 만들고, 수정·비활성화하고, 비밀번호를 정합니다(아니면 403 `forbidden`). 마지막 활성 관리자는 낮추거나 비활성화할 수 없습니다(409 `conflict`). 비활성화하거나 비밀번호를 새로 정하면 그 사용자의 세션이 모두 끝납니다.
- 워크플로 명령이 만든 이벤트(`workflow_event`)에는 실행한 사용자가 `actor`로 남습니다.

### 사용자와 프로젝트 멤버십

```bash
curl -b cookies.txt -X POST localhost:8080/api/v1/users -H 'content-type: application/json' \
  -d '{"email":"kim@example.com","name":"김개발","password":"<처음 비밀번호>"}'
curl -b cookies.txt -X PUT localhost:8080/api/v1/projects/<projectId>/members/<userId> -H 'content-type: application/json' -d '{"role":"owner"}'
# → { "role": "owner", "user": { "id", "email", "name", "active", "isAdmin", "version" } }
```

- 이메일은 앞뒤 공백을 지우고 소문자로 저장하며, 사용자 사이에 유일합니다(중복이면 409 `conflict`). 이름은 1~100자입니다.
- **사용자도 지우지 않고 비활성화합니다.** 이벤트 로그의 행위자로 남기 때문입니다. `DELETE`나 `PATCH {"active": false}`로 비활성화하고 `PATCH {"active": true}`로 되살립니다. 비활성 사용자는 새 멤버로 넣을 수 없지만(409), 이미 멤버면 그대로 남습니다.
- 역할은 `owner`·`editor`·`viewer`입니다. `PUT`은 멱등이라 없으면 넣고 있으면 역할만 바꿉니다.
- 소유자가 있는 프로젝트에서는 **마지막 소유자를 빼거나 낮출 수 없습니다**(409 `conflict`). 멤버가 없던 프로젝트도 있으므로 소유자가 반드시 있어야 하지는 않습니다.
- `GET /users/{userId}/projects`는 자기 것이나 관리자만 봅니다(아니면 403).

### 프로젝트 권한

프로젝트 안에서 할 수 있는 일은 역할이 정합니다. 표는 `domain/src/membership.rs` 한 곳에 있습니다.

| 하는 일 (`permissions`의 이름)                                 | viewer | editor | owner |
| -------------------------------------------------------------- | :----: | :----: | :---: |
| 프로젝트·워크플로·멤버 보기, 기록 검색 (`project.view`)        |   ✓    |   ✓    |   ✓   |
| 워크플로 시작 (`workflow.start`)                               |        |   ✓    |   ✓   |
| 워크플로 명령: 완료·취소·승인·재작업·기록 (`workflow.execute`) |        |   ✓    |   ✓   |
| 워크스페이스 화면 설정 저장 (`preferences.save`)               |        |   ✓    |   ✓   |
| 프로젝트 수정·보관 (`project.edit`)                            |        |        |   ✓   |
| 멤버 추가·역할 변경·제외 (`members.manage`)                    |        |        |   ✓   |
| 워크플로의 담당 배정 고치기 (`assignments.manage`)             |        |        |   ✓   |

- **프로젝트는 로그인한 누구나 만들고, 만든 사람이 소유자가 됩니다**(프로젝트와 소유자 멤버십을 한 트랜잭션으로 저장).
- **멤버가 아니면 404입니다.** 없는 프로젝트·워크플로와 똑같이 응답해서 있는지도 알 수 없습니다. 목록(`GET /projects`, `GET /workflows`)과 검색은 멤버인 프로젝트 것만 돌려줍니다.
- **멤버지만 역할이 모자라면 403 `forbidden`입니다.**
- **시스템 관리자(`isAdmin`)는 어느 프로젝트에서나 소유자입니다**(멤버가 아니어도).
- 프로젝트와 워크플로 응답에는 요청자의 `role`과 `permissions`(위 표의 이름들)가 담깁니다. 화면은 권한 표를 따로 갖지 않고 이 값으로 버튼을 켜고 끕니다.
- 멤버가 없는 프로젝트(인증이 생기기 전에 만든 것, 서버가 옮겨 만든 "이전 워크플로")는 관리자에게만 보입니다. 관리자가 소유자를 정해 넘깁니다.
- 화면 설정은 워크플로마다 하나라서(사용자별이 아님) 보기 전용 멤버는 저장하지 못합니다.
- 검색의 워크플로 조건은 가까운 `limit`개를 고른 뒤에 걸리므로, 볼 수 있는 결과가 `limit`보다 적게 나올 수 있습니다.

### 담당 배정 (RACI)

워크플로마다 누가 무엇을 맡는지 정합니다. 규칙은 `domain/src/assignment.rs` 한 곳에 있습니다.

```bash
curl -b cookies.txt -X PUT localhost:8080/api/v1/workflows/<workflowId>/assignments -H 'content-type: application/json' -d '{
  "expectedVersion": 0,
  "stages": [{ "stageId": "planning", "accountable": "<userId>", "responsible": ["<userId>"], "consulted": [], "informed": [] }],
  "tasks":  [{ "taskId": "goals", "responsible": ["<userId>"] }]
}'
```

| 명령                          | 배정이 있으면                   | 배정이 없으면 |
| ----------------------------- | ------------------------------- | ------------- |
| 작업 완료·완료 취소·기록 수정 | 그 작업의 담당자(R)             | 편집자 이상   |
| 단계 승인                     | 그 단계의 승인자(A)             | 편집자 이상   |
| 재작업 요청                   | 그 작업이 속한 단계의 승인자(A) | 편집자 이상   |

- **승인자(A)** 는 단계마다 많아야 한 명입니다. **담당자(R)** 는 작업마다 정하고, 작업에 없으면 그 단계의 기본 담당자를 따릅니다. 여러 명이면 누구나 합니다. **협의(C)·통보(I)** 는 단계마다 정하고 기록과 표시에만 씁니다.
- **배정된 일은 배정된 사람만 합니다**(아니면 403 `forbidden`). **소유자(관리자 포함)는 대신 할 수 있습니다.** 한 사람이 R과 A를 겸할 수 있습니다.
- 이벤트(`workflow_event.authority`)에 실행한 근거가 남습니다: `assigned`(배정된 사람), `open`(배정이 없었음), `override`(소유자가 대신).
- 워크플로 응답의 `assignments`에 배정이, `authority`에 요청자가 각 작업·단계를 실행할 수 있는지(`assigned`·`open`·`override`, 못 하면 `null`)가 담깁니다.
- 배정은 소유자만 고칩니다(`PUT`은 전체를 바꾸고, 목록에 없는 단계·작업은 배정이 없어집니다). 배정받는 사람은 그 프로젝트의 활성 멤버여야 하고, R·A는 편집자 이상이어야 합니다(아니면 400).
- 배정은 진행 상태와 버전을 따로 갖습니다(`expectedVersion`이 최신이 아니면 409 `versionConflict`). 바뀔 때마다 누가 언제 무엇으로 바꿨는지 `assignment_change`에 남습니다.
- **멤버에서 빠지면 그 프로젝트의 모든 워크플로에서 배정이 풀리고, 보기 전용으로 낮아지면 R·A에서만 풀립니다.** 풀린 자리는 배정이 없는 자리가 되어 편집자 이상이면 누구나 할 수 있게 됩니다. 비활성화된 사용자의 배정은 그대로 남습니다(소유자가 대신 하거나 배정을 바꿉니다).

### 내 할 일

`GET /api/v1/me/work`는 요청자가 멤버인 프로젝트의 워크플로에서 요청자가 맡은 일을 모아 돌려줍니다. 계산은 `domain/src/work.rs`의 순수 함수가 합니다.

```jsonc
{
  "items": [
    {
      "projectId": "…",
      "projectName": "결제 개편",
      "workflowId": "…",
      "workflowName": "웹",
      "group": "waiting",
      "kind": "task",
      "stageId": "planning",
      "stageIndex": 0,
      "taskId": "requirements",
      "taskNumber": 4,
      "wait": { "kind": "afterTasks", "remaining": 3 },
      "rework": false,
    },
  ],
}
```

| `group`    | 뜻                                                             |
| ---------- | -------------------------------------------------------------- |
| `ready`    | 내게 배정됐고 지금 할 수 있습니다                              |
| `waiting`  | 내게 배정됐지만 아직 차례가 아닙니다 (`wait`에 이유)           |
| `open`     | 아무도 배정되지 않았고 지금 할 수 있습니다 (편집자 이상에게만) |
| `watching` | 내가 협의(C)·통보(I) 대상인, 지금 진행 중인 단계               |

- `kind`는 `task`(작업 완료), `approval`(단계 승인), `consulted`, `informed`입니다. `wait`는 `afterTasks`(앞선 작업이 남음. 승인이면 그 단계의 남은 작업 수)이거나 `stageLocked`입니다.
- 내 배정은 잠긴 단계의 것까지 모두 나오고, 배정이 없는 일은 지금 차례인 것만 나옵니다.
- 끝난 일, 끝난 워크플로, 보관한 프로젝트, 소유자가 대신 할 수 있는 남의 일은 나오지 않습니다.
- 시스템 관리자도 **실제로 멤버인** 프로젝트만 봅니다(조직 전체의 미배정 작업이 할 일이 되지 않도록).
- 워크플로마다 배정을 한 번씩 읽습니다. 워크플로가 아주 많아지면 사용자별 색인이 필요합니다.

### 워크플로 명령

명령 종류: `completeTask {taskId}`(`completeAndNext`도 같음), `reopenTask {taskId}`, `approveStage {stageIndex}`, `requestRework {taskId, reason}`, `updateRecord {taskId, patch: {link?, note?}}`.

진행 상태는 `phase` 하나입니다(`unlockedStage`·`done`·진행률은 여기서 계산한 값).

- `{ "kind": "working", "stageIndex", "completed" }`: 그 단계의 앞 `completed`개를 마쳤고, 다음 차례는 그다음 작업
- `{ "kind": "awaitingApproval", "stageIndex" }`: 단계 작업을 모두 마치고 승인 대기(마지막 단계에는 없음)
- `{ "kind": "finished" }`: 공정 완료

작업은 순서대로만 완료하고, 단계 사이에는 승인(`approveStage`)이 필요하며, 완료 취소는 마지막으로 완료한 작업만 됩니다.
다음 단계에서 아직 아무것도 하지 않았을 때 앞 단계의 마지막 작업을 취소하면 그 단계의 승인도 취소됩니다(이벤트 `approvalRevoked`).

재작업(`requestRework`)은 완료한 작업 하나로 진행 위치를 되돌리고, 그 작업부터 지금까지 손댄 작업을 모두 다시 하게 합니다(사유 필수).
응답의 `rework`는 `{ "untilNumber", "reason" }`(재작업 범위의 끝 작업 번호와 사유) 또는 `null`입니다. 지나온 단계 승인은 취소되고(`approvalRevoked`), 범위를 모두 다시 완료하면 `reworkCompleted` 이벤트와 함께 `null`이 됩니다.
`expectedVersion`을 주면 그 버전일 때만 실행합니다(다른 탭과의 덮어쓰기 방지). 이미 원하는 상태인 명령은 `changed: false`로 성공합니다.

오류는 모두 `{ "error": { "code", "message", "details"? } }` 모양입니다.

| 상태 | code              | 언제                                                                                                                                                                      |
| ---- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `badRequest`      | JSON·쿼리·경로 형식 오류, 빈 검색어, 프로젝트·사용자 입력 규칙 위반, 알 수 없는 역할, `POST /workflows`에 `projectId` 없음                                                |
| 404  | `notFound`        | 없는 공정·프로젝트·사용자·멤버·워크플로·작업                                                                                                                              |
| 409  | `ruleViolation`   | 공정 규칙 위반. `details.kind`: `stageLocked`, `outOfOrder`, `notLastCompleted`, `reworkNotDone`, `reworkReasonRequired`, `stageIncomplete`, `notFrontStage`, `lastStage` |
| 409  | `versionConflict` | `expectedVersion`이 최신이 아님                                                                                                                                           |
| 409  | `conflict`        | 보관한 프로젝트에 워크플로 시작, 이미 쓰는 이메일, 마지막 소유자 빼기·낮추기, 비활성 사용자를 멤버로 넣기                                                                 |
| 500  | `internal`        | 저장소·외부 서비스 오류 (세부는 서버 로그에만)                                                                                                                            |

## 테스트

| 크레이트                   | 무엇을                                     | 어떻게                                        |
| -------------------------- | ------------------------------------------ | --------------------------------------------- |
| domain                     | 공정 정의 검증, 진행 규칙                  | 순수 단위 테스트                              |
| application                | 명령 계획과 버전 충돌 우선순위             | 순수 단위 테스트                              |
| runtime                    | 유스케이스 흐름과 색인 작업 실행           | 메모리 포트(`process-flow-testing`)           |
| adapter-process-cache      | 조회 캐시와 저장 반영                      | 메모리 저장소를 사용하는 단위 테스트          |
| api                        | HTTP 계약(상태 코드, JSON 모양)            | `actix_web::test` + 메모리 포트               |
| adapter-sqlite             | 저장 계약, 원자성, 버전 충돌, 내구성 큐    | 실제 SQLite 메모리·파일 DB                    |
| adapter-lancedb            | 코사인 검색, 필터, 영속성, 색인 메타데이터 | 임시 LanceDB 디렉터리                         |
| adapter-security·embedding | 해시 검증, 토큰, 임베딩 정규화             | 단위 테스트                                   |
| server                     | 환경 변수 파싱, 실제 DB 저장·복원          | 순수 단위 테스트, 실행 파일 통합 테스트(unix) |

## 아직 없는 것 (다음 단계 후보)

- **마지막 소유자 검사의 원자성**: 지금은 검사와 저장이 한 트랜잭션이 아니라, 두 소유자를 동시에 빼는 요청이 겹치면 둘 다 통과할 수 있습니다.
- **통보(I) 알림**: 지금은 통보 대상을 기록하고 보여 주기만 합니다.
- **배정 템플릿·위임**: 프로젝트 단위의 기본 배정, 승인자가 자기 단계의 담당자를 직접 정하기.
- **멤버십 변경 이력**: 누가 누구의 역할을 바꿨는지는 남기지 않습니다.
- **사용자별 화면 설정**: 지금은 워크플로마다 하나를 멤버가 함께 씁니다.
- **마지막 관리자 검사의 원자성**: 마지막 소유자 검사와 같은 한계가 있습니다.
