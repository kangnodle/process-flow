$ErrorActionPreference = 'Stop'
$benchmarkDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'tests/benchmark'
$k6 = Get-Command k6 -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $k6) {
  [Console]::Error.WriteLine('k6 was not found on PATH. Install Grafana k6 to run the benchmark.')
  exit 127
}

$PSNativeCommandUseErrorActionPreference = $false
$envArgs = @()
$benchArgs = @()
$holdSeconds = $null
$users = $null
for ($i = 0; $i -lt $args.Count; $i++) {
  $arg = [string]$args[$i]
  if ($arg -cin '-h', '--help') {
    Write-Host 'Usage: bench-all.ps1 [--users N] [--hold-seconds N] [-e NAME=value] [k6 benchmark flags]'
    Write-Host '--users N (or -Users N): run the load profile with N total peak virtual users (positive integer).'
    Write-Host '--hold-seconds N (or -HoldSeconds N): run the load profile and hold peak load for N seconds (positive integer). Overrides PROFILE and HOLD.'
    & $k6.Source run --help
    exit $LASTEXITCODE
  }
  if ($arg -in '--hold-seconds', '-HoldSeconds' -or $arg -clike '--hold-seconds=*') {
    if ($arg -clike '--hold-seconds=*') {
      $holdSeconds = $arg.Substring('--hold-seconds='.Length)
    } else {
      $i++
      $holdSeconds = if ($i -lt $args.Count) { [string]$args[$i] } else { '' }
    }
    if ($holdSeconds -cnotmatch '^[0-9]+$' -or $holdSeconds -cnotmatch '[1-9]') {
      [Console]::Error.WriteLine('--hold-seconds requires a positive integer.')
      exit 2
    }
  } elseif ($arg -in '--users', '-Users' -or $arg -clike '--users=*') {
    if ($arg -clike '--users=*') {
      $users = $arg.Substring('--users='.Length)
    } else {
      $i++
      $users = if ($i -lt $args.Count) { [string]$args[$i] } else { '' }
    }
    if ($users -cnotmatch '^[0-9]+$' -or $users -cnotmatch '[1-9]') {
      [Console]::Error.WriteLine('--users requires a positive integer.')
      exit 2
    }
  } elseif ($arg -cin '-e', '--env') {
    $i++
    if ($i -ge $args.Count) {
      [Console]::Error.WriteLine("$arg requires NAME=value")
      exit 2
    }
    $envArgs += @('-e', $args[$i])
  } elseif ($arg -clike '--env=*' -or $arg -clike '-e=*') {
    $envArgs += @('-e', $arg.Substring($arg.IndexOf('=') + 1))
  } elseif ($arg -clike '-e?*') {
    $envArgs += @('-e', $arg.Substring(2))
  } else {
    $benchArgs += $arg
  }
}

if ($null -ne $holdSeconds) {
  $envArgs += @('-e', 'PROFILE=load', '-e', "HOLD=${holdSeconds}s")
}
if ($null -ne $users) {
  $envArgs += @('-e', 'PROFILE=load', '-e', "TOTAL_VUS=$users")
}

$originalEmail = $env:BENCH_EMAIL
$originalPassword = $env:BENCH_PASSWORD
$email = $originalEmail
$password = $originalPassword
$otherEnvArgs = @()
for ($i = 0; $i -lt $envArgs.Count; $i += 2) {
  $value = [string]$envArgs[$i + 1]
  if ($value.StartsWith('BENCH_EMAIL=')) {
    $email = $value.Substring('BENCH_EMAIL='.Length)
  } elseif ($value.StartsWith('BENCH_PASSWORD=')) {
    $password = $value.Substring('BENCH_PASSWORD='.Length)
  } else {
    $otherEnvArgs += @('-e', $value)
  }
}
$envArgs = $otherEnvArgs

if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrEmpty($password)) {
  if ([Console]::IsInputRedirected) {
    [Console]::Error.WriteLine('Set BENCH_EMAIL and BENCH_PASSWORD for an administrator, or run from a terminal to enter them.')
    exit 2
  }
  if ([string]::IsNullOrWhiteSpace($email)) { $email = Read-Host 'Administrator email' }
  if ([string]::IsNullOrEmpty($password)) {
    $securePassword = Read-Host 'Administrator password' -AsSecureString
    $password = [System.Net.NetworkCredential]::new('', $securePassword).Password
    $securePassword.Dispose()
  }
}
if ([string]::IsNullOrWhiteSpace($email) -or [string]::IsNullOrEmpty($password)) {
  [Console]::Error.WriteLine('Benchmark email and password are required.')
  exit 2
}

$runId = [Guid]::NewGuid().ToString('N')
$envArgs += @('-e', "BENCH_RUN_ID=$runId", '-e', 'BENCH_MANAGED_ACCOUNT=1')
$status = 0
try {
  $env:BENCH_EMAIL = $email
  $env:BENCH_PASSWORD = $password
  Write-Host "Creating test account for benchmark run $runId"
  & $k6.Source run --include-system-env-vars=true --no-setup=false @envArgs (Join-Path $benchmarkDir 'create-account.js')
  $status = $LASTEXITCODE
  if ($status -eq 0) {
    Write-Host "Seeding benchmark run $runId"
    & $k6.Source run --include-system-env-vars=true --no-setup=false @envArgs (Join-Path $benchmarkDir 'seed.js')
    $status = $LASTEXITCODE
  }
  if ($status -eq 0) {
    & $k6.Source run @benchArgs --include-system-env-vars=true @envArgs -e BENCH_ALLOW_WRITES=1 (Join-Path $benchmarkDir 'process-flow.js')
    $status = $LASTEXITCODE
  }
} finally {
  try {
    Write-Host "Cleaning up benchmark run $runId"
    & $k6.Source run --include-system-env-vars=true --no-setup=false @envArgs -e CLEANUP_APPLY=1 (Join-Path $benchmarkDir 'cleanup.js')
    $cleanupStatus = $LASTEXITCODE
    if ($cleanupStatus -ne 0) {
      [Console]::Error.WriteLine("Cleanup failed for benchmark run $runId (exit $cleanupStatus).")
    }
    if ($status -eq 0) { $status = $cleanupStatus }
  } finally {
    $env:BENCH_EMAIL = $originalEmail
    $env:BENCH_PASSWORD = $originalPassword
  }
}
exit $status
