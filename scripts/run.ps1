[CmdletBinding()]
param(
  [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
  [string[]] $Arguments = @(),
  [string] $Target = '',
  [switch] $NoInstall,
  [switch] $NoRun,
  [switch] $Demo,
  [switch] $ListenHost,
  [int] $Port = 0,
  [int] $BePort = 0,
  [switch] $Mem,
  [switch] $Prebuilt,
  [switch] $Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Write-Step([string] $Message) { Write-Host "`n==> $Message" -ForegroundColor Blue }
function Write-Ok([string] $Message) { Write-Host "✔ $Message" -ForegroundColor Green }
function Write-Warn([string] $Message) { Write-Host "! $Message" -ForegroundColor Yellow }
function Stop-WithError([string] $Message) { Write-Host "✘ $Message" -ForegroundColor Red; exit 1 }

if ($Help) {
  Write-Host @'
mise를 이용해 frontend, backend, 또는 전체(all) 워크스페이스의
포맷팅 · 린팅 · 빌드 · 테스트 · 실행을 한 곳에서 처리합니다.

사용법: ./scripts/run.ps1 [대상] [명령...] [옵션]
  대상(all | fe | be)과 명령을 지정해 실행합니다.
  대상을 생략하면 `all`(전체), 명령을 생략하면 `all`(전체 단계)입니다.

대상
  all                 프론트엔드 + 백엔드 전체 (기본값)
  fe, frontend        프론트엔드 (frontend/)
  be, backend         백엔드 (backend/)

명령
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
  -Target <대상>      실행 대상 명시 (all | fe | be)
  -NoInstall          install 단계를 건너뜀
  -NoRun              all에서 마지막 dev 실행을 건너뜀
  -Demo               프론트엔드 VITE_DEMO=true로 실행 (시연용 상태)
  -ListenHost         프론트엔드 dev/preview를 외부 접속 가능하게(0.0.0.0) 실행
  -Port <번호>        프론트엔드 dev/preview 포트
  -BePort <번호>      백엔드 서버 포트 (APP_PORT)
  -Mem                백엔드 서버를 인메모리 SQLite와 임시 LanceDB로 실행
  -Prebuilt           백엔드를 빌드하지 않고 기존 바이너리로 개발 서버 실행
  -Help               도움말

예
  ./scripts/run.ps1                       # [전체] install → format → lint → test → build → dev
  ./scripts/run.ps1 fe                    # [프론트엔드] 전체 파이프라인 실행
  ./scripts/run.ps1 be check              # [백엔드] 검사만 (CI용)
  ./scripts/run.ps1 check                 # [전체] 프론트엔드 + 백엔드 검사 (CI용)
  ./scripts/run.ps1 fe dev -Port 3000 -Demo
  ./scripts/run.ps1 be dev -Mem
'@
  exit 0
}

function Resolve-TargetName([string] $Value) {
  switch ($Value.ToLowerInvariant()) {
    { $_ -in 'all', 'both', 'full' } { return 'all' }
    { $_ -in 'fe', 'frontend', 'web' } { return 'fe' }
    { $_ -in 'be', 'backend', 'server', 'api' } { return 'be' }
    default { return $null }
  }
}

$Commands = @()
if ($Target -ne '') {
  $resolved = Resolve-TargetName $Target
  if ($null -eq $resolved) { Stop-WithError "알 수 없는 대상: $Target (all | fe | be)" }
  $Target = $resolved
}

foreach ($arg in $Arguments) {
  if ($Target -eq '' -and $Commands.Count -eq 0) {
    $maybeTarget = Resolve-TargetName $arg
    if ($null -ne $maybeTarget) {
      $Target = $maybeTarget
      continue
    }
  }
  $Commands += $arg
}

if ($Target -eq '') { $Target = 'all' }
if ($Commands.Count -eq 0) { $Commands = @('all') }

if ($Prebuilt) {
  foreach ($command in $Commands) {
    if ($command -notin 'install', 'build', 'dev', 'run', 'start', 'all') {
      Stop-WithError "-Prebuilt에서 지원하지 않는 명령: $command (install | build | dev | all)"
    }
  }
}

function Get-BackendBinary {
  $backendDir = Join-Path $RootDir 'backend'
  $targetDir = $env:CARGO_TARGET_DIR
  if ([string]::IsNullOrWhiteSpace($targetDir)) { $targetDir = 'target' }
  if (-not [System.IO.Path]::IsPathRooted($targetDir)) {
    $targetDir = Join-Path $backendDir $targetDir
  }
  $binaryName = 'process-flow-server'
  if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { $binaryName += '.exe' }
  $binary = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $targetDir 'debug') $binaryName))
  if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    Stop-WithError "백엔드 바이너리가 없습니다: $binary`n먼저 빌드하세요: cd backend; cargo build -p process-flow-server"
  }
  return $binary
}

$BackendBinary = $null
if ($Prebuilt -and $Target -in 'be', 'all') { $BackendBinary = Get-BackendBinary }

function Invoke-Native {
  param([Parameter(Mandatory)] [string] $Exe, [string[]] $CmdArgs = @())
  & $Exe @CmdArgs
  if ($LASTEXITCODE -ne 0) { Stop-WithError "실패: $Exe $($CmdArgs -join ' ') (종료 코드 $LASTEXITCODE)" }
}

function Initialize-Mise {
  $env:MISE_IGNORED_CONFIG_PATHS = (Join-Path $HOME '.tool-versions')
  $env:MISE_DISABLE_TOOLS = 'sbcl'

  $cargoBin = Join-Path $HOME '.cargo\bin'
  if ((Test-Path $cargoBin) -and ($env:PATH -notlike "*$cargoBin*")) {
    $env:PATH = "$cargoBin;$env:PATH"
  }

  if (-not (Get-Command mise -ErrorAction SilentlyContinue)) {
    $candidates = @(
      (Join-Path $HOME '.local\bin'),
      $cargoBin,
      (Join-Path $env:LOCALAPPDATA 'mise\bin')
    )
    foreach ($dir in $candidates) {
      if (Test-Path (Join-Path $dir 'mise.exe')) {
        $env:PATH = "$dir;$env:PATH"
        break
      }
    }
  }
  if (-not (Get-Command mise -ErrorAction SilentlyContinue)) {
    Stop-WithError 'mise가 설치되어 있지 않습니다. https://mise.jdx.dev/ 를 참고해 설치하세요.'
  }

  & mise trust (Join-Path $RootDir 'mise.toml') 2>&1 | Out-Null

  if (-not $NoInstall) {
    if ($Target -in 'fe', 'all') {
      & mise which node 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) {
        Write-Step 'mise로 Node.js 툴체인 확인 및 설치'
        Invoke-Native mise @('install', 'node')
      }
    }
    if (-not $Prebuilt -and $Target -in 'be', 'all') {
      if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Step 'mise로 Rust 툴체인(1.98.0) 설치'
        Invoke-Native mise @('use', '--local', 'rust@1.98.0')
      }
    }
  }
}

function Get-TaskName([string] $Base) {
  if ($Target -eq 'all') { return $Base }
  return "${Target}:${Base}"
}

function Get-TargetLabel {
  switch ($Target) {
    'all' { return '전체 (frontend + backend)' }
    'fe'  { return '프론트엔드 (frontend)' }
    'be'  { return '백엔드 (backend)' }
  }
}

function Get-FeServerArgs {
  $a = @()
  if ($ListenHost) { $a += '--host' }
  if ($Port -gt 0) { $a += @('--port', "$Port") }
  return , $a
}

function Assert-FeDeps {
  if ($Target -in 'fe', 'all') {
    $feModules = Join-Path (Join-Path $RootDir 'frontend') 'node_modules'
    if (-not (Test-Path $feModules)) {
      if ($Prebuilt -and $NoInstall) {
        Stop-WithError '프론트엔드 의존성이 없습니다. mise run fe:install 또는 cd frontend; npm ci 실행 후 다시 시도하세요.'
      }
      Invoke-Native mise @('run', 'fe:install')
    }
  }
}

$script:Installed = $false
function Invoke-InstallStep {
  if ($NoInstall -or $script:Installed -or ($Prebuilt -and $Target -eq 'be')) { return }
  $t = Get-TaskName 'install'
  if ($Prebuilt) { $t = 'fe:install' }
  Write-Step "[$(Get-TargetLabel)] 의존성 준비 ($t)"
  Invoke-Native mise @('run', $t)
  $script:Installed = $true
  Write-Ok '의존성 준비 완료'
}

function Invoke-FormatStep {
  Assert-FeDeps
  $t = Get-TaskName 'format'
  Write-Step "[$(Get-TargetLabel)] 코드 포맷팅 ($t)"
  Invoke-Native mise @('run', $t)
  Write-Ok '포맷팅 완료'
}

function Invoke-FormatCheckStep {
  Assert-FeDeps
  $t = Get-TaskName 'format:check'
  Write-Step "[$(Get-TargetLabel)] 포맷팅 검사 ($t)"
  Invoke-Native mise @('run', $t)
  Write-Ok '포맷팅 이상 없음'
}

function Invoke-LintStep {
  Assert-FeDeps
  $t = Get-TaskName 'lint'
  Write-Step "[$(Get-TargetLabel)] 린트 검사 ($t)"
  Invoke-Native mise @('run', $t)
  Write-Ok '린트 통과'
}

function Invoke-LintFixStep {
  Assert-FeDeps
  $t = Get-TaskName 'lint:fix'
  Write-Step "[$(Get-TargetLabel)] 린트 자동 수정 ($t)"
  Invoke-Native mise @('run', $t)
  Write-Ok '린트 수정 완료'
}

function Invoke-TypecheckStep {
  Assert-FeDeps
  $t = Get-TaskName 'typecheck'
  Write-Step "[$(Get-TargetLabel)] 타입·컴파일 검사 ($t)"
  Invoke-Native mise @('run', $t)
  Write-Ok '타입·컴파일 검사 통과'
}

function Invoke-TestStep {
  Assert-FeDeps
  $t = Get-TaskName 'test'
  Write-Step "[$(Get-TargetLabel)] 테스트 ($t)"
  Invoke-Native mise @('run', $t)
  Write-Ok '테스트 통과'
}

function Invoke-BuildStep {
  if ($Prebuilt -and $Target -eq 'be') { return }
  Assert-FeDeps
  $t = Get-TaskName 'build'
  if ($Prebuilt) { $t = 'fe:build' }
  Write-Step "[$(Get-TargetLabel)] 빌드 ($t)"
  Invoke-Native mise @('run', $t)
  Write-Ok '빌드 완료'
}

function Invoke-DevStep {
  if ($Prebuilt -and $NoRun) { Write-Ok '개발 서버 실행 생략'; return }
  if ($Prebuilt -and $Target -eq 'be') {
    Write-Step '[백엔드] 기존 바이너리 실행 (Ctrl+C로 종료)'
    Push-Location (Join-Path $RootDir 'backend')
    try { Invoke-Native $BackendBinary }
    finally { Pop-Location }
    return
  }
  Assert-FeDeps
  $t = Get-TaskName 'dev'
  Write-Step "[$(Get-TargetLabel)] 개발 서버 실행 (Ctrl+C로 종료)"
  $feArgs = Get-FeServerArgs
  if ($Prebuilt -and $Target -eq 'all') {
    $supervisor = Join-Path $PSScriptRoot 'dev-servers.mjs'
    $miseExecutable = (Get-Command mise -CommandType Application | Select-Object -First 1).Source
    Invoke-Native mise (@('exec', '--', 'node', $supervisor, $BackendBinary, $miseExecutable) + $feArgs)
  } elseif ($Target -eq 'fe' -and $feArgs.Count -gt 0) {
    Invoke-Native mise (@('run', 'fe:dev', '--') + $feArgs)
  } else {
    Invoke-Native mise @('run', $t)
  }
}

function Invoke-PreviewStep {
  if ($Target -eq 'be') { Stop-WithError 'preview 명령은 프론트엔드(fe) 전용입니다.' }
  Assert-FeDeps
  Write-Step '[프론트엔드] 빌드 결과 미리 보기 (Ctrl+C로 종료)'
  $feArgs = Get-FeServerArgs
  if ($feArgs.Count -gt 0) {
    Invoke-Native mise (@('run', 'fe:preview', '--') + $feArgs)
  } else {
    Invoke-Native mise @('run', 'fe:preview')
  }
}

function Invoke-CleanStep {
  $t = Get-TaskName 'clean'
  Write-Step "[$(Get-TargetLabel)] 정리 ($t)"
  Invoke-Native mise @('run', $t)
  Write-Ok '정리 완료'
}

function Invoke-CommandItem([string] $Name) {
  switch ($Name) {
    'install'      { if (-not $Prebuilt) { $script:NoInstall = $false }; Invoke-InstallStep }
    { $_ -in 'format', 'fmt' } { Invoke-FormatStep }
    { $_ -in 'format:check', 'fmt:check' } { Invoke-FormatCheckStep }
    'lint'         { Invoke-LintStep }
    'lint:fix'     { Invoke-LintFixStep }
    'typecheck'    { Invoke-TypecheckStep }
    'test'         { Invoke-TestStep }
    'build'        { Invoke-BuildStep }
    { $_ -in 'dev', 'run', 'start' } { Invoke-DevStep }
    'preview'      { Invoke-PreviewStep }
    'check'        { Invoke-InstallStep; Invoke-FormatCheckStep; Invoke-LintStep; Invoke-TypecheckStep; Invoke-TestStep }
    'all' {
      if ($Prebuilt) {
        Invoke-InstallStep; Invoke-BuildStep; Invoke-DevStep
        return
      }
      Invoke-InstallStep; Invoke-FormatStep; Invoke-LintStep; Invoke-TestStep; Invoke-BuildStep
      if ($NoRun) { Write-Ok '모든 단계 완료' } else { Invoke-DevStep }
    }
    'clean'        { Invoke-CleanStep }
    'tasks'        { Invoke-Native mise @('tasks') }
    { $_ -like 'fe:*' -or $_ -like 'be:*' } {
      Write-Step "mise 태스크 직접 실행 ($_)"
      Invoke-Native mise @('run', $_)
    }
    default        { Stop-WithError "알 수 없는 명령: $Name (도움말: -Help)" }
  }
}

if ($Demo) { $env:VITE_DEMO = 'true' }
if ($BePort -gt 0) { $env:APP_PORT = "$BePort" }
$memoryStorageDir = $null
$previousSqliteUrl = $env:SQLITE_URL
$previousLanceUri = $env:LANCEDB_URI
if ($Mem) {
  $memoryStorageDir = Join-Path ([System.IO.Path]::GetTempPath()) ('process-flow-' + [guid]::NewGuid().ToString())
  $env:SQLITE_URL = 'sqlite::memory:'
  $env:LANCEDB_URI = Join-Path $memoryStorageDir 'search.lancedb'
}

Push-Location $RootDir
try {
  if ($Prebuilt -and $Target -eq 'be') {
    Write-Host "process-flow ($(Get-TargetLabel)) | 기존 바이너리"
  } else {
    Initialize-Mise
    $miseVer = (& mise --version) -split '\s+' | Select-Object -First 1
    Write-Host "process-flow ($(Get-TargetLabel)) | mise $miseVer"
  }
  foreach ($c in $Commands) { Invoke-CommandItem $c }
}
finally {
  Pop-Location
  if ($Mem) {
    $env:SQLITE_URL = $previousSqliteUrl
    $env:LANCEDB_URI = $previousLanceUri
    if (Test-Path $memoryStorageDir) { Remove-Item $memoryStorageDir -Recurse -Force }
  }
}

exit 0
