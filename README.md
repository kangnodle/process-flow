# process-flow

6단계 공정의 문서, 증빙, 진행 상태와 담당 배정을 관리합니다. React 프론트엔드와 Rust API 서버를 workspace 패키지로 구성하며, SQLite를 기준 저장소로 사용하고 LanceDB로 작업 기록을 검색합니다.

- [백엔드 실행과 저장소 운영](backend/README.md)
- [프론트엔드 실행](frontend/README.md)
- [부하 테스트](tests/benchmark/README.md)

개발 서버는 `./scripts/dev.sh` 또는 PowerShell의 `./scripts/dev.ps1`로 실행합니다.
기존 백엔드 바이너리를 직접 실행하며 Cargo를 호출하지 않습니다.
처음 실행할 때와 백엔드 코드를 변경한 뒤에는 저장소 루트에서
`cd backend && cargo build -p process-flow-server`로 먼저 빌드하세요.
PowerShell에서는 `cd backend; cargo build -p process-flow-server`를 사용합니다.
바이너리가 없으면 실행을 중단하고 빌드 방법을 안내합니다.
기본 경로는 `backend/target/debug/process-flow-server`이며 Windows에서는 `.exe`가 붙습니다.
`CARGO_TARGET_DIR`을 지정하면 해당 디렉터리를 사용하고, 상대 경로는 `backend/`를 기준으로 해석합니다.

기본 실행 대상은 프론트엔드와 백엔드 전체이며 프론트엔드 의존성 준비와 빌드를 유지합니다.
`fe`·`be` 대상과 포트, 호스트, 데모, 메모리 저장소 옵션도 그대로 사용할 수 있습니다.
예를 들어 `./scripts/dev.sh --no-install --mem --port 3000 --be-port 8081` 또는
`./scripts/dev.ps1 -NoInstall -Mem -Port 3000 -BePort 8081`로 실행합니다.
`--no-run` / `-NoRun`은 서버 실행을 생략하고, Ctrl+C는 함께 실행한 두 서버를 종료합니다.
백엔드만 실행할 때는 mise나 Node.js가 필요하지 않습니다.
포맷·린트·테스트와 백엔드 빌드를 포함한 기존 파이프라인은 `scripts/run.sh` / `scripts/run.ps1`을 사용합니다.

작업 문서 양식의 원본은 `contracts/task-forms.json`입니다. 변경 후 저장소 루트에서
`node tools/catalog/generate.mjs`를 실행하면 프론트엔드 JSON과 Rust 정적 양식을 생성합니다.
`node tools/catalog/generate.mjs --check`는 파일을 수정하지 않고 생성물의 누락과 변경을 검사합니다.
Rust 도메인 빌드는 프론트엔드 파일이나 생성 스크립트를 읽지 않습니다.

`node tools/architecture/check.mjs`는 Cargo metadata와 npm workspace manifest를 확인하여
계층의 역방향 의존성, 순수 코어의 외부 실행 의존성, 패키지 내부 경로와 순환 의존성을 거부합니다.
기존 Rust application의 `async-trait`와 `thiserror`는 포트와 오류 타입 선언에 사용하는 허용 목록입니다.
테스트 전용 의존성은 별도로 취급합니다.
`mise run tools:test`는 외부 의존성 없이 잘못된 양식, 금지된 패키지 의존성과 개발 실행기를 검사합니다.
실행기 테스트는 POSIX 환경에서 동작하며 `PWSH_PATH`에 PowerShell 실행 파일을 지정하면 PowerShell 경로도 검사합니다.
프론트엔드 의존성을 설치한 뒤 `npm --prefix frontend run tools:test`를 실행하면
ESLint의 순수 계층과 UI 저장소 경계 fixture도 검사합니다.
프론트엔드 `npm run check`와 mise의 프론트엔드·백엔드 check에도 이 검사가 포함됩니다.
