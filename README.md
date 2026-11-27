# Process Flow

Process Flow는 소프트웨어 개발의 6단계 공정을 프로젝트별로 관리하는 웹 애플리케이션입니다. 기획·분석부터 설계·디자인, 개발, 테스트·QA, 배포·출시, 운영·유지보수까지 작업과 진행 상황을 추적합니다.

## 주요 기능

- 단계·작업·보드 보기에서 진행 상황을 확인하고, 작업 완료와 단계 승인, 재작업을 처리합니다.
- 작업별 문서를 작성하고 검토 결과와 링크·파일 증빙을 기록합니다.
- 프로젝트별로 워크플로와 멤버를 관리하고, RACI 담당 배정과 내 할 일을 확인합니다.
- 작업 기록의 벡터 검색을 HTTP API로 제공합니다.

## 빠른 시작

Node.js 22, npm, mise, Rust 1.98.0, Protocol Buffers 컴파일러(`protoc`)를 사용합니다. Node.js 버전은 [mise 설정](mise.toml)에, Rust 버전과 구성 요소는 [Rust 툴체인 설정](backend/rust-toolchain.toml)에 지정되어 있습니다.

저장소 루트에서 백엔드를 빌드하고 두 개발 서버를 실행합니다.

**macOS / Linux**

```bash
(cd backend && cargo build -p process-flow-server)
./scripts/dev.sh
```

**Windows PowerShell**

```powershell
Push-Location backend
cargo build -p process-flow-server
Pop-Location
./scripts/dev.ps1
```

1. 브라우저에서 [http://localhost:5173](http://localhost:5173)을 엽니다. Vite는 `/api` 요청을 백엔드 `http://127.0.0.1:8080`으로 전달합니다.
2. 새 데이터베이스로 시작했다면 화면에서 첫 관리자 계정을 만듭니다.
3. 프로젝트를 만들고 그 안에서 워크플로를 시작합니다.

백엔드 상태는 `curl http://127.0.0.1:8080/health`로 확인할 수 있습니다.

## 실행 옵션과 설정

개발 스크립트는 프론트엔드 의존성을 설치하고 빌드한 뒤 기존 백엔드 바이너리와 함께 실행합니다. 백엔드 코드를 변경한 뒤에는 위의 Cargo 빌드 명령을 다시 실행하세요. 기본 바이너리 경로는 `backend/target/debug/process-flow-server`이며 Windows에서는 `.exe`가 붙습니다. 상대 `CARGO_TARGET_DIR`은 `backend/` 기준입니다.

| 실행 방식               | Bash                         | PowerShell                   |
| ----------------------- | ---------------------------- | ---------------------------- |
| 프론트엔드 시연 모드    | `./scripts/dev.sh fe --demo` | `./scripts/dev.ps1 fe -Demo` |
| 백엔드만 실행           | `./scripts/dev.sh be`        | `./scripts/dev.ps1 be`       |
| 임시 저장소로 전체 실행 | `./scripts/dev.sh --mem`     | `./scripts/dev.ps1 -Mem`     |
| 전체 옵션 보기          | `./scripts/dev.sh --help`    | `./scripts/dev.ps1 -Help`    |

시연 모드는 브라우저에서 샘플 워크플로를 실행합니다. 임시 저장소 모드는 인메모리 SQLite와 종료 시 정리되는 임시 LanceDB 디렉터리를 사용합니다. 이미 빌드한 백엔드만 실행할 때는 mise와 Node.js가 필요 없습니다.

백엔드는 환경 변수로 설정합니다. 기본 저장 위치는 `backend/data/process-flow.sqlite3`과 `backend/data/search.lancedb`입니다. 백엔드 포트를 바꾸면 [Vite 프록시 대상](frontend/apps/web/vite.config.ts)도 맞춰야 합니다. 브라우저가 다른 출처의 API에 직접 접속하는 구성에서는 백엔드의 `CORS_ALLOWED_ORIGINS`에 웹 앱의 출처를 지정합니다. 설정 예시는 [백엔드 설정](backend/.env.example)과 [웹 설정](frontend/apps/web/.env.example)에 있습니다.

## 저장소 구조

| 경로                                 | 역할                                            |
| ------------------------------------ | ----------------------------------------------- |
| [frontend/](frontend/)               | React·TypeScript·Vite 웹 앱과 npm 워크스페이스  |
| [backend/](backend/)                 | Rust·Actix Web API 서버와 Cargo 워크스페이스    |
| [contracts/](contracts/)             | 프론트엔드와 백엔드에서 공유하는 작업 문서 양식 |
| [scripts/](scripts/)                 | Bash·PowerShell 개발 및 검증 실행기             |
| [tools/](tools/)                     | 양식 생성, 의존성 경계 검사, 실행기 테스트      |
| [tests/benchmark/](tests/benchmark/) | k6 부하 테스트                                  |

두 워크스페이스는 순수 규칙과 포트를 코어 패키지에 두고 HTTP, 브라우저, 저장소 접근을 어댑터에서 처리합니다. SQLite가 업무 데이터의 원본을 보관하고 LanceDB가 작업 기록의 검색 색인을 관리합니다.

## 개발 및 검증

다음 명령은 저장소 루트에서 실행합니다. 처음에는 `mise install node`로 Node.js를 준비합니다.

| 명령                          | 설명                                                  |
| ----------------------------- | ----------------------------------------------------- |
| `mise run check`              | 양식과 의존성 경계, 포맷, 린트, 타입, 테스트 검사     |
| `mise run fe:check`           | 프론트엔드 검사                                       |
| `mise run be:check`           | 백엔드 검사                                           |
| `mise run tools:test`         | 양식 생성기, 의존성 경계, 개발 실행기 테스트          |
| `mise run catalog:generate`   | 공통 양식에서 프론트엔드 JSON과 Rust 정적 데이터 생성 |
| `mise run catalog:check`      | 양식 생성물이 원본과 일치하는지 검사                  |
| `mise run architecture:check` | npm·Cargo 워크스페이스의 의존성 경계 검사             |

작업 문서 양식은 [contracts/task-forms.json](contracts/task-forms.json)을 수정한 뒤 `mise run catalog:generate`로 양쪽 생성물을 갱신합니다. 전체 포맷 적용과 빌드까지 실행하려면 Bash에서 `./scripts/run.sh all --no-run`, PowerShell에서 `./scripts/run.ps1 all -NoRun`을 사용합니다.

## 관련 문서

- [프론트엔드 개발과 패키지 구조](frontend/README.md)
- [백엔드 API, 저장소 운영, 검색 색인 복구](backend/README.md)
- [부하 테스트](tests/benchmark/README.md)
- [변경 이력](docs/CHANGELOG.md)

## 라이선스

Process Flow는 독점 소프트웨어이며 모든 권리는 저작권자에게 있습니다. 사용 및 배포 조건은 저장소 루트의 [LICENSE](LICENSE)를 따릅니다. 서드파티 구성 요소에는 각 구성 요소의 라이선스가 적용됩니다.
