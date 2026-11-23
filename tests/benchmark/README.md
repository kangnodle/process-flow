# Process Flow API 부하 테스트

[k6](https://grafana.com/docs/k6/latest/get-started/installation/)로 웹 앱이 사용하는 HTTP API를 측정합니다. 브라우저 렌더링 시간은 포함하지 않습니다.

| 시나리오   | 한 번의 반복에서 하는 일                                                                     | 부하 프로필의 최대 VU |
| ---------- | -------------------------------------------------------------------------------------------- | --------------------: |
| `browse`   | 프로젝트 목록·상세, 워크플로 목록·상세, 표준 공정과 선행 작업, 내 할 일, 기록 검색           |                     8 |
| `progress` | 워크플로 한 개 생성 → 기획 단계의 각 작업에 메모·필수 문서 저장 → 작업 완료 → 기획 단계 승인 |                     2 |
| `session`  | 로그인 → 인증 상태 확인 → 로그아웃                                                           |                     1 |

## 로컬에서 실행

이미 실행 중인 서버에 관리자 계정이 있다면 `./scripts/bench-all.sh` 또는 `./scripts/bench-all.ps1`을 바로 실행할 수 있습니다. 계정 환경 변수가 없으면 터미널에서 관리자 이메일과 비밀번호를 입력받으며, 비밀번호 입력은 숨겨집니다. 기본 서버 주소는 `http://127.0.0.1:8080`입니다. 다른 주소는 `-e BASE_URL=http://127.0.0.1:18080`처럼 지정합니다. CI에서는 `BENCH_EMAIL`과 `BENCH_PASSWORD`를 환경 변수로 설정합니다.

별도 터미널에서 임시 메모리 DB로 API를 실행합니다.

Bash

```bash
cd backend
APP_PORT=18080 SQLITE_URL=sqlite::memory: LANCEDB_URI=data/benchmark-search.lancedb cargo run
```

PowerShell

```powershell
Set-Location backend
$env:APP_PORT = '18080'
$env:SQLITE_URL = 'sqlite::memory:'
$env:LANCEDB_URI = 'data/benchmark-search.lancedb'
cargo run
```

새 터미널을 열고 저장소 루트에서 아래 예시를 실행합니다. `auth/setup` 호출은 빈 로컬 DB에 계정을 만들 때 한 번만 실행합니다. 이미 초기화된 테스트 서버라면 이 호출을 건너뛰고 해당 서버 주소와 기존 관리자 계정을 설정합니다.

Bash

```bash
export BASE_URL=http://127.0.0.1:18080
curl --fail-with-body -X POST "$BASE_URL/api/v1/auth/setup" \
  -H 'Content-Type: application/json' \
  -d '{"email":"benchmark@example.test","name":"Benchmark","password":"local-k6-password"}'

export BENCH_EMAIL=benchmark@example.test
export BENCH_PASSWORD=local-k6-password

# 시나리오마다 1 VU로 스모크 테스트를 한 번 실행
./scripts/bench-all.sh

# 부하를 15초 동안 늘리고 45초간 유지한 뒤 15초 동안 줄임
./scripts/bench-all.sh -e PROFILE=load
```

PowerShell

```powershell
$env:BASE_URL = 'http://127.0.0.1:18080'
Invoke-RestMethod -Method Post -Uri "$env:BASE_URL/api/v1/auth/setup" `
  -ContentType 'application/json' `
  -Body '{"email":"benchmark@example.test","name":"Benchmark","password":"local-k6-password"}'

$env:BENCH_EMAIL = 'benchmark@example.test'
$env:BENCH_PASSWORD = 'local-k6-password'

# 시나리오마다 1 VU로 스모크 테스트를 한 번 실행
./scripts/bench-all.ps1

# 부하를 15초 동안 늘리고 45초간 유지한 뒤 15초 동안 줄임
./scripts/bench-all.ps1 -e PROFILE=load
```

테스트는 `k6-benchmark-*` 프로젝트를 새로 만들고, 검색용 기록이 색인에 나타나면 측정을 시작합니다. 조회와 진행 시나리오는 준비 단계에서 발급된 세션을 공유합니다. 로그인 시나리오는 반복마다 별도 세션을 발급하고 종료합니다. 진행 시나리오는 반복마다 새 워크플로를 사용해 같은 워크플로의 버전 충돌을 피합니다.

통합 스크립트는 테스트 계정 생성 → 사전 데이터 생성 → 부하 테스트 → 프로젝트 및 계정 정리를 순서대로 실행합니다. 생성이나 부하 테스트가 실패해도 이번 실행 ID가 붙은 시드 프로젝트와 임시 테스트 프로젝트를 정리합니다. 생성 또는 부하 테스트의 실패 코드가 우선이며, 정리만 실패하면 정리의 실패 코드를 반환합니다.

실행마다 일반 사용자 권한의 테스트 계정을 자동 생성하고, 시드와 부하 테스트는 그 계정으로 수행합니다. 입력받은 관리자 계정은 계정 생성과 정리에 사용합니다. 정리 시 이번 실행의 프로젝트를 삭제한 뒤 테스트 계정을 비활성화하고 세션을 모두 종료합니다. 현재 사용자 API는 비활성화를 제공하므로 계정 레코드는 남습니다.

## 사전 데이터 규모

`-e` 또는 `--env`로 전달한 환경 변수는 모든 단계에 공통으로 적용합니다. `--out` 같은 다른 k6 옵션은 부하 테스트에만 전달합니다. 다음 예시는 프로젝트 10개, 워크플로 50개, 작업 기록 400개를 생성하고 부하 테스트를 실행합니다.

```bash
./scripts/bench-all.sh -e SEED_PROJECTS=10 -e SEED_WORKFLOWS=50 -e SEED_RECORDS=400 -e PROFILE=load
```

```powershell
./scripts/bench-all.ps1 -e SEED_PROJECTS=10 -e SEED_WORKFLOWS=50 -e SEED_RECORDS=400 -e PROFILE=load
```

| 환경 변수         | 기본값 | 용도                             |
| ----------------- | -----: | -------------------------------- |
| `SEED_PROJECTS`   |      3 | 생성할 프로젝트 총개수 (1 이상)  |
| `SEED_WORKFLOWS`  |     12 | 생성할 워크플로 총개수 (0 이상)  |
| `SEED_RECORDS`    |     60 | 생성할 작업 기록 총개수 (0 이상) |
| `SEED_TIMEOUT`    |  `30m` | 데이터 준비에 허용할 최대 시간   |
| `CLEANUP_TIMEOUT` |  `30m` | 데이터 정리에 허용할 최대 시간   |

워크플로는 프로젝트에, 작업 기록은 워크플로에 고르게 나눠 생성합니다. 작업 하나에는 기록 하나를 저장할 수 있으므로, 현재 표준 공정에서는 워크플로당 최대 25개입니다. 워크플로를 0개로 설정할 때는 기록도 0개로 지정합니다. 다음 단계에 기록을 넣어야 하면 앞 단계의 작업을 완료하고 승인합니다. 검색 색인은 서버에서 비동기로 갱신됩니다.

사전 데이터는 프로젝트 목록과 내 할 일 조회에 반영됩니다. 워크플로 상세 조회와 기록 검색은 실행마다 만든 테스트 워크플로를 대상으로 합니다.

## 정리 재시도

강제 종료나 서버 연결 오류로 정리가 끝나지 않으면 서버와 계정 설정을 확인한 뒤, 로그의 실행 ID로 같은 범위만 정리할 수 있습니다. 아래 명령의 `RUN_ID_FROM_LOG`를 로그에 나온 실제 값으로 바꿉니다.

```sh
k6 run -e BENCH_RUN_ID=RUN_ID_FROM_LOG -e BENCH_MANAGED_ACCOUNT=1 -e CLEANUP_APPLY=1 tests/benchmark/cleanup.js
```

## 설정과 결과

| 환경 변수                                         | 기본값                  | 용도                                                                         |
| ------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `BASE_URL`                                        | `http://127.0.0.1:8080` | API 서버 주소. HTTPS 전용 세션 쿠키를 쓰는 서버라면 HTTPS 주소를 지정합니다. |
| `BENCH_EMAIL`, `BENCH_PASSWORD`                   | 필수                    | 벤치마크 관리자 계정                                                         |
| `PROFILE`                                         | `smoke`                 | `smoke` 또는 `load`                                                          |
| `TOTAL_VUS`                                       | 미지정                  | 부하 프로필의 전체 최대 가상 사용자 수. 지정하면 시나리오별 VU 설정보다 우선 |
| `BROWSE_VUS`, `PROGRESS_VUS`, `AUTH_VUS`          | `8`, `2`, `1`           | 부하 프로필의 시나리오별 최대 가상 사용자 수                                 |
| `RAMP_UP`, `HOLD`, `RAMP_DOWN`                    | `15s`, `45s`, `15s`     | 부하 프로필의 구간별 시간                                                    |
| `BROWSE_P95_MS`, `PROGRESS_P95_MS`, `AUTH_P95_MS` | `750`, `1000`, `1500`   | 시나리오별 요청 시간 p95 기준(밀리초)                                        |

### 동시 사용자 수와 부하 유지 시간

두 옵션 모두 양의 정수를 받으며, 어느 하나라도 지정하면 자동으로 `load` 프로필을 사용합니다.

| 옵션               | 의미                                        | PowerShell 별칭  | 우선 적용되는 설정                         |
| ------------------ | ------------------------------------------- | ---------------- | ------------------------------------------ |
| `--users N`        | 세 시나리오를 합한 최대 동시 가상 사용자 수 | `-Users N`       | `PROFILE`, `TOTAL_VUS`, 시나리오별 VU 설정 |
| `--hold-seconds S` | 최대 부하를 유지하는 시간(초)               | `-HoldSeconds S` | `PROFILE`, `HOLD`                          |

서버 주소와 관리자 계정을 위와 같이 설정한 뒤, 저장소 루트에서 실행합니다. 아래 예시는 총 50명의 가상 사용자로 최대 부하를 120초 유지합니다.

```bash
./scripts/bench-all.sh --users 50 --hold-seconds 120
```

```powershell
./scripts/bench-all.ps1 --users 50 --hold-seconds 120
```

PowerShell 별칭으로도 같은 설정을 적용할 수 있습니다.

```powershell
./scripts/bench-all.ps1 -Users 50 -HoldSeconds 120
```

기본 부하 구간은 **15초 증가 → 120초 유지 → 15초 감소**로 총 150초입니다. 전체 실행에는 계정·데이터 준비, 진행 중인 반복의 종료 대기, 정리 시간도 추가됩니다. 증가·감소 시간은 `-e RAMP_UP=10s -e RAMP_DOWN=10s`처럼 조정할 수 있습니다.

### 시나리오별 사용자 수 배분

`--users N`은 조회·작업 진행·로그인에 기본 8:2:1 비율을 기준으로 배분합니다. N이 3 이상일 때 계산은 다음과 같습니다. `floor`는 소수점 이하를 버리는 내림입니다.

- 로그인 `session`에 `max(1, floor(N / 11))`명을 배정합니다.
- 작업 진행 `progress`에 `max(1, floor(2 × N / 11))`명을 배정합니다.
- 조회 `browse`에는 나머지를 배정해 총합을 정확히 N명으로 맞춥니다.

| `--users` | 조회 `browse` | 작업 진행 `progress` | 로그인 `session` | 합계 |
| --------: | ------------: | -------------------: | ---------------: | ---: |
|         1 |             1 |                    0 |                0 |    1 |
|         2 |             1 |                    1 |                0 |    2 |
|         3 |             1 |                    1 |                1 |    3 |
|        11 |             8 |                    2 |                1 |   11 |
|        20 |            16 |                    3 |                1 |   20 |
|        50 |            37 |                    9 |                4 |   50 |
|       100 |            73 |                   18 |                9 |  100 |

N이 1이면 조회만 실행하고, 2이면 조회와 작업 진행에 각각 1명을 배정합니다. 0명이 배정된 시나리오는 실행과 임계값 평가에서 제외됩니다. VU는 자동 생성한 테스트 계정을 공유하는 가상 실행자이며, 계정은 실행마다 하나를 생성합니다.

`--users`와 `TOTAL_VUS`를 모두 생략하면 `BROWSE_VUS`, `PROGRESS_VUS`, `AUTH_VUS`의 개별 설정을 사용합니다. 기본 부하 프로필은 각각 8명·2명·1명으로 총 11명이고, 기본 유지 시간은 45초입니다. 두 실행 옵션과 `PROFILE`을 모두 생략하면 스모크 프로필로 각 시나리오를 1 VU씩 한 번 실행합니다.

각 시나리오는 HTTP 실패율 1% 미만, 응답 검증 통과율 100%, 반복 완료 1회 이상, 설정한 p95 미만을 요구합니다. [k6 임계값](https://grafana.com/docs/k6/latest/using-k6/thresholds/)을 넘으면 종료 코드가 0이 아닙니다. p95 기본값은 운영 SLA가 아니라 비교를 위한 초기 기준입니다. 준비와 정리 요청은 시나리오별 임계값에서 제외되지만 전체 요약에는 포함됩니다.
