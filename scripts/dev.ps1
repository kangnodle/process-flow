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
  [Alias('h')]
  [switch] $Help
)

$ErrorActionPreference = 'Stop'

if ($Help -or $Arguments -contains '--help') {
  Write-Host @'
기존 백엔드 바이너리와 프론트엔드 개발 서버를 실행합니다.
프론트엔드 의존성 준비 → 프론트엔드 빌드 → 개발 서버 실행만 수행합니다.
백엔드는 먼저 cd backend; cargo build -p process-flow-server 로 빌드하세요.
포맷팅 · 린팅 · 테스트 · 백엔드 빌드가 필요하면 scripts/run.ps1을 쓰세요.

사용법: ./scripts/dev.ps1 [대상] [옵션]
  대상: all (기본값) | fe (frontend) | be (backend)
  옵션은 scripts/run.ps1과 같습니다 (-Mem, -BePort, -Port, -ListenHost, -Demo, -NoInstall, -NoRun).
  CARGO_TARGET_DIR을 지정하면 해당 경로의 debug/process-flow-server를 사용합니다.

  예) ./scripts/dev.ps1
      ./scripts/dev.ps1 fe -Port 3000
      ./scripts/dev.ps1 be -Mem
'@
  exit 0
}

$runOptions = @{
  Arguments = @($Arguments) + @('install', 'build', 'dev')
  Target = $Target
  NoInstall = $NoInstall
  NoRun = $NoRun
  Demo = $Demo
  ListenHost = $ListenHost
  Port = $Port
  BePort = $BePort
  Mem = $Mem
  Prebuilt = $true
}

& (Join-Path $PSScriptRoot 'run.ps1') @runOptions
exit $LASTEXITCODE
