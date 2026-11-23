#!/usr/bin/env bash
set -eo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
BENCHMARK_DIR="$ROOT_DIR/tests/benchmark"

if ! command -v k6 >/dev/null 2>&1; then
  printf '%s\n' 'k6 was not found on PATH. Install Grafana k6 to run the benchmark.' >&2
  exit 127
fi

env_args=()
bench_args=()
hold_seconds=""
users=""
while (($#)); do
  case "$1" in
    -h|--help)
      printf '%s\n\n' 'Usage: bench-all.sh [--users N] [--hold-seconds N] [-e NAME=value] [k6 benchmark flags]'
      printf '%s\n\n' '--users N: run the load profile with N total peak virtual users (positive integer).'
      printf '%s\n\n' '--hold-seconds N: run the load profile and hold peak load for N seconds (positive integer). Overrides PROFILE and HOLD.'
      exec k6 run --help
      ;;
    --hold-seconds|--hold-seconds=*)
      if [[ "$1" == --hold-seconds ]]; then
        hold_seconds="${2:-}"
        if (($# < 2)); then
          printf '%s\n' '--hold-seconds requires a positive integer.' >&2
          exit 2
        fi
        shift 2
      else
        hold_seconds="${1#*=}"
        shift
      fi
      if [[ ! "$hold_seconds" =~ ^[0-9]+$ || ! "$hold_seconds" =~ [1-9] ]]; then
        printf '%s\n' '--hold-seconds requires a positive integer.' >&2
        exit 2
      fi
      ;;
    --users|--users=*)
      if [[ "$1" == --users ]]; then
        users="${2:-}"
        if (($# < 2)); then
          printf '%s\n' '--users requires a positive integer.' >&2
          exit 2
        fi
        shift 2
      else
        users="${1#*=}"
        shift
      fi
      if [[ ! "$users" =~ ^[0-9]+$ || ! "$users" =~ [1-9] ]]; then
        printf '%s\n' '--users requires a positive integer.' >&2
        exit 2
      fi
      ;;
    -e|--env)
      if (($# < 2)); then
        printf '%s\n' "$1 requires NAME=value" >&2
        exit 2
      fi
      env_args+=(-e "$2")
      shift 2
      ;;
    -e=*|--env=*) env_args+=(-e "${1#*=}"); shift ;;
    -e?*) env_args+=(-e "${1#-e}"); shift ;;
    *) bench_args+=("$1"); shift ;;
  esac
done

if [[ -n "$hold_seconds" ]]; then
  env_args+=(-e PROFILE=load -e "HOLD=${hold_seconds}s")
fi
if [[ -n "$users" ]]; then
  env_args+=(-e PROFILE=load -e "TOTAL_VUS=$users")
fi

other_env_args=()
for ((i=0; i<${#env_args[@]}; i+=2)); do
  value="${env_args[i+1]}"
  case "$value" in
    BENCH_EMAIL=*) BENCH_EMAIL="${value#*=}" ;;
    BENCH_PASSWORD=*) BENCH_PASSWORD="${value#*=}" ;;
    *) other_env_args+=(-e "$value") ;;
  esac
done
env_args=("${other_env_args[@]}")

if [[ -z "${BENCH_EMAIL//[[:space:]]/}" || -z "${BENCH_PASSWORD:-}" ]]; then
  if [[ ! -t 0 ]]; then
    printf '%s\n' 'Set BENCH_EMAIL and BENCH_PASSWORD for an administrator, or run from a terminal to enter them.' >&2
    exit 2
  fi
  if [[ -z "${BENCH_EMAIL//[[:space:]]/}" ]]; then
    read -r -p 'Administrator email: ' BENCH_EMAIL
  fi
  if [[ -z "${BENCH_PASSWORD:-}" ]]; then
    read -r -s -p 'Administrator password: ' BENCH_PASSWORD
    printf '\n' >&2
  fi
fi
if [[ -z "${BENCH_EMAIL//[[:space:]]/}" || -z "${BENCH_PASSWORD:-}" ]]; then
  printf '%s\n' 'Benchmark email and password are required.' >&2
  exit 2
fi
export BENCH_EMAIL BENCH_PASSWORD

run_dir="$(mktemp -d "${TMPDIR:-/tmp}/process-flow-bench.XXXXXXXXXXXX")"
run_id="${run_dir##*.}"
rmdir -- "$run_dir"
env_args+=(-e "BENCH_RUN_ID=$run_id" -e BENCH_MANAGED_ACCOUNT=1)

cleanup() {
  local status=$? cleanup_status=0
  trap - EXIT
  printf '\nCleaning up benchmark run %s\n' "$run_id"
  k6 run --include-system-env-vars=true --no-setup=false "${env_args[@]}" -e CLEANUP_APPLY=1 "$BENCHMARK_DIR/cleanup.js" || cleanup_status=$?
  if ((cleanup_status != 0)); then
    printf 'Cleanup failed for benchmark run %s (exit %s).\n' "$run_id" "$cleanup_status" >&2
  fi
  if ((status == 0)); then status=$cleanup_status; fi
  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf 'Creating test account for benchmark run %s\n' "$run_id"
k6 run --include-system-env-vars=true --no-setup=false "${env_args[@]}" "$BENCHMARK_DIR/create-account.js"
printf 'Seeding benchmark run %s\n' "$run_id"
k6 run --include-system-env-vars=true --no-setup=false "${env_args[@]}" "$BENCHMARK_DIR/seed.js"
k6 run "${bench_args[@]}" --include-system-env-vars=true "${env_args[@]}" -e BENCH_ALLOW_WRITES=1 "$BENCHMARK_DIR/process-flow.js"
