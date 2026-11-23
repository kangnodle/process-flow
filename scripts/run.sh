#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -t 1 ]]; then
  C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_RESET=$'\033[0m'
else
  C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_RESET=""
fi
step() { printf '\n%s==> %s%s\n' "$C_BLUE" "$*" "$C_RESET"; }
ok()   { printf '%s✔ %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s! %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2; }
die()  { printf '%s✘ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; exit 1; }
trap 'die "실패: ${BASH_COMMAND} (줄 ${LINENO})"' ERR

usage() {
  cat <<EOF
사용법: $(basename "$0") [대상] [명령...] [옵션]

대상 (생략하면 기본값: all)
  all                 프론트엔드 + 백엔드 전체
  fe, frontend        프론트엔드 (frontend/)
  be, backend         백엔드 (backend/)

명령 (여러 개를 순서대로 실행, 기본값: all)
  install             툴체인(mise install) 및 패키지 의존성 준비
  format, fmt         코드 포맷팅 (Prettier / cargo fmt)
  format:check        포맷팅 검사만 (파일 수정 안 함)
  lint                린트 검사 (ESLint / cargo clippy)
  lint:fix            린트 자동 수정
  typecheck           타입·컴파일 검사 (tsc -b / cargo check)
  test                테스트 실행 (Vitest / cargo test)
  build               빌드 (apps/web/dist/ 및 cargo build)
  dev, run, start     개발 서버 실행 (fe: 5173, be: 8080, all: 동시 실행)
  preview             프론트엔드 빌드 결과 미리 보기 (fe 전용)
  check               install → format:check → lint → typecheck → test (CI용)
  all                 install → format → lint → test → build → dev
  clean               빌드 산출물 및 캐시 삭제
  tasks               mise에 등록된 전체 태스크 목록 보기

옵션
  -t, --target <대상> 실행 대상 지정 (all | fe | be)
  --no-install        install 단계를 건너뜀
  --no-run            all에서 마지막 dev 실행을 건너뜀
  --prebuilt          기존 백엔드 바이너리 사용 (프런트엔드만 준비·빌드)
  --demo              프론트엔드 VITE_DEMO=true로 실행 (시연용 상태)
  --host              프론트엔드 dev/preview를 외부 접속 가능하게(0.0.0.0) 실행
  --port <n>          프론트엔드 dev/preview 포트 (기본 5173)
  --be-port <n>       백엔드 서버 포트 (APP_PORT, 기본 8080)
  --mem               백엔드 서버를 인메모리 SQLite와 임시 LanceDB로 실행
  -h, --help          도움말
EOF
}

TARGET=""
COMMANDS=()
NO_INSTALL=0
NO_RUN=0
PREBUILT=0
MEMORY_MODE=0
MEMORY_STORAGE_DIR=""
FE_SERVER_ARGS=()

normalize_target() {
  case "$1" in
    all|both|full) echo "all" ;;
    fe|frontend|web) echo "fe" ;;
    be|backend|server|api) echo "be" ;;
    *) echo "" ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    -t|--target)
      [[ $# -ge 2 ]] || die "--target에 값(all|fe|be)이 필요합니다."
      TARGET="$(normalize_target "$2")"
      [[ -n "$TARGET" ]] || die "알 수 없는 대상: $2 (all | fe | be)"
      shift
      ;;
    --target=*)
      TARGET="$(normalize_target "${1#*=}")"
      [[ -n "$TARGET" ]] || die "알 수 없는 대상: ${1#*=} (all | fe | be)"
      ;;
    --no-install) NO_INSTALL=1 ;;
    --no-run) NO_RUN=1 ;;
    --prebuilt) PREBUILT=1 ;;
    --demo) export VITE_DEMO=true ;;
    --host) FE_SERVER_ARGS+=(--host) ;;
    --port)
      [[ $# -ge 2 ]] || die "--port에 포트 번호가 필요합니다."
      FE_SERVER_ARGS+=(--port "$2")
      shift
      ;;
    --port=*) FE_SERVER_ARGS+=(--port "${1#*=}") ;;
    --be-port)
      [[ $# -ge 2 ]] || die "--be-port에 포트 번호가 필요합니다."
      export APP_PORT="$2"
      shift
      ;;
    --be-port=*) export APP_PORT="${1#*=}" ;;
    --mem) MEMORY_MODE=1 ;;
    -*) die "알 수 없는 옵션: $1 (도움말: --help)" ;;
    *)
      if [[ -z "$TARGET" && ${#COMMANDS[@]} -eq 0 ]]; then
        t="$(normalize_target "$1")"
        if [[ -n "$t" ]]; then
          TARGET="$t"
        else
          COMMANDS+=("$1")
        fi
      else
        COMMANDS+=("$1")
      fi
      ;;
  esac
  shift
done

[[ -z "$TARGET" ]] && TARGET="all"
[[ ${#COMMANDS[@]} -eq 0 ]] && COMMANDS=(all)

BACKEND_BINARY=""
if [[ $PREBUILT -eq 1 ]]; then
  for command in "${COMMANDS[@]}"; do
    case "$command" in
      install|build|dev|run|start|all) ;;
      *) die "--prebuilt는 install, build, dev 명령에만 사용할 수 있습니다." ;;
    esac
  done
  if [[ "$TARGET" != "fe" ]]; then
    backend_target="${CARGO_TARGET_DIR:-target}"
    case "$backend_target" in
      /*) ;;
      *) backend_target="${ROOT_DIR}/backend/${backend_target}" ;;
    esac
    BACKEND_BINARY="${backend_target}/debug/process-flow-server"
    case "${OSTYPE:-}" in msys*|cygwin*|win32*) BACKEND_BINARY="${BACKEND_BINARY}.exe" ;; esac
    if [[ ! -f "$BACKEND_BINARY" || ! -x "$BACKEND_BINARY" ]]; then
      die "백엔드 실행 파일이 없습니다: ${BACKEND_BINARY}
먼저 저장소 루트에서 빌드하세요: cd backend && cargo build -p process-flow-server"
    fi
  fi
fi

if [[ $MEMORY_MODE -eq 1 ]]; then
  MEMORY_STORAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/process-flow.XXXXXXXX")"
  export SQLITE_URL="sqlite::memory:"
  export LANCEDB_URI="${MEMORY_STORAGE_DIR}/search.lancedb"
  trap 'rm -rf -- "$MEMORY_STORAGE_DIR"' EXIT
fi

run_server_task() {
  if [[ -n "$MEMORY_STORAGE_DIR" ]]; then
    mise run "$@"
  else
    exec mise run "$@"
  fi
}

ensure_mise() {
  if [[ $PREBUILT -eq 1 && "$TARGET" == "be" ]]; then return 0; fi
  export MISE_IGNORED_CONFIG_PATHS="${HOME}/.tool-versions:${HOME}/.config/mise"
  export MISE_DISABLE_TOOLS="sbcl"

  if [[ -d "${HOME}/.cargo/bin" && ":${PATH}:" != *":${HOME}/.cargo/bin:"* ]]; then
    export PATH="${HOME}/.cargo/bin:${PATH}"
  fi

  if ! command -v mise >/dev/null 2>&1; then
    for candidate in "${HOME}/.local/bin" "${HOME}/.cargo/bin" "/opt/homebrew/bin" "/usr/local/bin"; do
      if [[ -x "${candidate}/mise" ]]; then
        export PATH="${candidate}:${PATH}"
        break
      fi
    done
  fi
  command -v mise >/dev/null 2>&1 || die "mise가 설치되어 있지 않습니다. https://mise.jdx.dev/ 를 참고해 설치하세요."

  mise trust "${ROOT_DIR}/mise.toml" >/dev/null 2>&1 || true

  if [[ $NO_INSTALL -eq 0 ]]; then
    if [[ "$TARGET" == "fe" || "$TARGET" == "all" ]]; then
      if ! mise which node >/dev/null 2>&1; then
        step "mise로 Node.js 툴체인 확인 및 설치"
        mise install node
      fi
    fi
    if [[ $PREBUILT -eq 0 && ( "$TARGET" == "be" || "$TARGET" == "all" ) ]]; then
      if ! command -v cargo >/dev/null 2>&1; then
        step "mise로 Rust 툴체인(1.98.0) 설치"
        mise use --local "rust@1.98.0"
      fi
    fi
  fi
}

task_name() {
  local base="$1"
  if [[ "$TARGET" == "all" ]]; then
    echo "$base"
  else
    echo "${TARGET}:${base}"
  fi
}

target_label() {
  case "$TARGET" in
    all) echo "전체 (frontend + backend)" ;;
    fe)  echo "프론트엔드 (frontend)" ;;
    be)  echo "백엔드 (backend)" ;;
  esac
}

run_mise_task() {
  local task="$1"
  shift
  if [[ $# -gt 0 ]]; then
    mise run "$task" -- "$@"
  else
    mise run "$task"
  fi
}

INSTALLED=0
do_install() {
  [[ $NO_INSTALL -eq 1 || $INSTALLED -eq 1 ]] && return 0
  if [[ $PREBUILT -eq 1 && "$TARGET" == "be" ]]; then return 0; fi
  step "[$(target_label)] 의존성 준비 ($(task_name install))"
  if [[ $PREBUILT -eq 1 ]]; then run_mise_task fe:install; else run_mise_task "$(task_name install)"; fi
  INSTALLED=1
  ok "의존성 준비 완료"
}

need_fe_deps() {
  if [[ "$TARGET" == "fe" || "$TARGET" == "all" ]]; then
    if [[ $PREBUILT -eq 1 && $NO_INSTALL -eq 1 && ! -d "${ROOT_DIR}/frontend/node_modules" ]]; then
      die "프런트엔드 의존성이 없습니다. 먼저 cd frontend && npm ci 를 실행하세요."
    fi
    [[ -d "${ROOT_DIR}/frontend/node_modules" ]] || run_mise_task "fe:install"
  fi
}

do_format() {
  need_fe_deps
  step "[$(target_label)] 코드 포맷팅 ($(task_name format))"
  run_mise_task "$(task_name format)"
  ok "포맷팅 완료"
}

do_format_check() {
  need_fe_deps
  step "[$(target_label)] 포맷팅 검사 ($(task_name format:check))"
  run_mise_task "$(task_name format:check)"
  ok "포맷팅 이상 없음"
}

do_lint() {
  need_fe_deps
  step "[$(target_label)] 린트 검사 ($(task_name lint))"
  run_mise_task "$(task_name lint)"
  ok "린트 통과"
}

do_lint_fix() {
  need_fe_deps
  step "[$(target_label)] 린트 자동 수정 ($(task_name lint:fix))"
  run_mise_task "$(task_name lint:fix)"
  ok "린트 수정 완료"
}

do_typecheck() {
  need_fe_deps
  step "[$(target_label)] 타입·컴파일 검사 ($(task_name typecheck))"
  run_mise_task "$(task_name typecheck)"
  ok "타입·컴파일 검사 통과"
}

do_test() {
  need_fe_deps
  step "[$(target_label)] 테스트 ($(task_name test))"
  run_mise_task "$(task_name test)"
  ok "테스트 통과"
}

do_build() {
  if [[ $PREBUILT -eq 1 && "$TARGET" == "be" ]]; then return 0; fi
  need_fe_deps
  step "[$(target_label)] 빌드 ($(task_name build))"
  if [[ $PREBUILT -eq 1 ]]; then run_mise_task fe:build; else run_mise_task "$(task_name build)"; fi
  ok "빌드 완료"
}

do_dev() {
  if [[ $PREBUILT -eq 1 && $NO_RUN -eq 1 ]]; then ok "개발 서버 실행 생략"; return 0; fi
  if [[ $PREBUILT -eq 1 && "$TARGET" == "be" ]]; then
    step "[백엔드] 기존 바이너리 실행 (Ctrl+C로 종료)"
    trap - ERR
    cd "${ROOT_DIR}/backend"
    if [[ -n "$MEMORY_STORAGE_DIR" ]]; then "$BACKEND_BINARY"; else exec "$BACKEND_BINARY"; fi
    return
  fi
  need_fe_deps
  step "[$(target_label)] 개발 서버 실행 (Ctrl+C로 종료)"
  trap - ERR
  if [[ $PREBUILT -eq 1 && "$TARGET" == "all" ]]; then
    if [[ -n "$MEMORY_STORAGE_DIR" ]]; then
      mise exec -- node "${SCRIPT_DIR}/dev-servers.mjs" "$BACKEND_BINARY" "$(command -v mise)" "${FE_SERVER_ARGS[@]}"
    else
      exec mise exec -- node "${SCRIPT_DIR}/dev-servers.mjs" "$BACKEND_BINARY" "$(command -v mise)" "${FE_SERVER_ARGS[@]}"
    fi
  elif [[ "$TARGET" == "fe" && ${#FE_SERVER_ARGS[@]} -gt 0 ]]; then
    run_server_task fe:dev -- "${FE_SERVER_ARGS[@]}"
  else
    run_server_task "$(task_name dev)"
  fi
}

do_preview() {
  [[ "$TARGET" == "be" ]] && die "preview 명령은 프론트엔드(fe) 전용입니다."
  need_fe_deps
  step "[프론트엔드] 빌드 결과 미리 보기 (Ctrl+C로 종료)"
  trap - ERR
  if [[ ${#FE_SERVER_ARGS[@]} -gt 0 ]]; then
    run_server_task fe:preview -- "${FE_SERVER_ARGS[@]}"
  else
    run_server_task fe:preview
  fi
}

do_clean() {
  step "[$(target_label)] 정리 ($(task_name clean))"
  run_mise_task "$(task_name clean)"
  ok "정리 완료"
}

run_command() {
  case "$1" in
    install)            if [[ $PREBUILT -eq 0 ]]; then NO_INSTALL=0; fi; do_install ;;
    format|fmt)         do_format ;;
    format:check|fmt:check) do_format_check ;;
    lint)               do_lint ;;
    lint:fix)           do_lint_fix ;;
    typecheck)          do_typecheck ;;
    test)               do_test ;;
    build)              do_build ;;
    dev|run|start)      do_dev ;;
    preview)            do_preview ;;
    check)              do_install; do_format_check; do_lint; do_typecheck; do_test ;;
    all)                if [[ $PREBUILT -eq 1 ]]; then do_install; do_build; do_dev; return; fi
                        do_install; do_format; do_lint; do_test; do_build
                        if [[ $NO_RUN -eq 1 ]]; then ok "모든 단계 완료"; else do_dev; fi ;;
    clean)              do_clean ;;
    tasks)              mise tasks ;;
    fe:*|be:*)          step "mise 태스크 직접 실행 ($1)"; run_mise_task "$1" ;;
    *)                  die "알 수 없는 명령: $1 (도움말: --help)" ;;
  esac
}

cd "$ROOT_DIR"
ensure_mise
if [[ $PREBUILT -eq 1 && "$TARGET" == "be" ]]; then
  printf 'process-flow (%s) | 기존 바이너리\n' "$(target_label)"
else
  printf 'process-flow (%s) | mise %s\n' "$(target_label)" "$(mise --version | awk '{print $1}')"
fi
for cmd in "${COMMANDS[@]}"; do
  run_command "$cmd"
done
