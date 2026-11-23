#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  -h|--help)
    cat <<'EOF'
기존 백엔드 바이너리와 프런트엔드를 실행합니다. Cargo는 호출하지 않습니다.
프런트엔드 의존성 준비 → 프런트엔드 빌드 → 개발 서버 실행 순서입니다.
백엔드 바이너리가 없으면 cd backend && cargo build -p process-flow-server 로 먼저 빌드하세요.

사용법: scripts/dev.sh [대상] [옵션]
  대상: all (기본값) | fe (frontend) | be (backend)
  옵션은 scripts/run.sh와 같습니다 (--mem, --be-port, --port, --host, --demo, --no-install, --no-run).
  CARGO_TARGET_DIR을 지정하면 해당 경로의 debug/process-flow-server를 사용합니다.

  예) scripts/dev.sh                  # [전체] 프런트엔드 준비·빌드 + 기존 백엔드 실행
      scripts/dev.sh fe --port 3000   # [프론트엔드] 3000번 포트로 실행
      scripts/dev.sh be --mem         # [백엔드] 인메모리 SQLite와 임시 LanceDB로 실행
EOF
    exit 0
    ;;
esac

exec "${SCRIPT_DIR}/run.sh" "$@" --prebuilt install build dev
