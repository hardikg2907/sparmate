# Interview Room Windows PowerShell Setup Script
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir

Write-Host "=== Interview Room Windows Setup ===" -ForegroundColor Cyan

# 1. Check for Podman or Docker
$Engine = $null
if (Get-Command podman -ErrorAction SilentlyContinue) {
    $Engine = "podman"
} elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    $Engine = "docker"
} else {
    Write-Error "Neither podman nor docker was found in PATH. Please install Podman or Docker Desktop for Windows (with WSL 2)."
    exit 1
}
Write-Host "Using container engine: $Engine" -ForegroundColor Green

# 2. Build container image
$ImageName = if ($env:IMAGE_NAME) { $env:IMAGE_NAME } else { "interview-room:latest" }
Write-Host "Building image $ImageName..." -ForegroundColor Green
& $Engine build -t $ImageName -f "$ScriptDir/Containerfile" "$AppDir"
if ($LASTEXITCODE -ne 0) { throw "Image build failed" }

# 3. Create named volumes
Write-Host "Creating named volumes..." -ForegroundColor Green
& $Engine volume create interview-room-data | Out-Null
& $Engine volume create interview-room-kokoro | Out-Null
& $Engine volume create interview-room-claude | Out-Null

# 4. Study folder path
$DefaultStudy = Join-Path $HOME "interview-prep"
if ($env:STUDY_PATH) {
    $StudyDir = $env:STUDY_PATH
} else {
    $Prompt = Read-Host "Study folder path [$DefaultStudy]"
    $StudyDir = if ([string]::IsNullOrWhiteSpace($Prompt)) { $DefaultStudy } else { $Prompt }
}
if ($StudyDir.StartsWith("~")) {
    $StudyDir = Join-Path $HOME $StudyDir.Substring(1).TrimStart("\", "/")
}
New-Item -ItemType Directory -Force -Path $StudyDir | Out-Null
Write-Host "Study folder: $StudyDir" -ForegroundColor Green

# 5. The app copies the study kit into an empty study folder on first start.

# 6. Kokoro model download and verify
$ModelUrl = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
$ModelSha = "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"
$VoicesUrl = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
$VoicesSha = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"

Write-Host "Checking Kokoro neural TTS model files..." -ForegroundColor Green
& $Engine run --rm -v interview-room-kokoro:/kokoro $ImageName sh -c @"
set -e
check_model() { echo '$ModelSha  /kokoro/kokoro-v1.0.onnx' | sha256sum -c - >/dev/null 2>&1; }
check_voices() { echo '$VoicesSha  /kokoro/voices-v1.0.bin' | sha256sum -c - >/dev/null 2>&1; }
if ! check_model; then
  echo 'Downloading kokoro-v1.0.onnx...'
  curl -fL -o /kokoro/kokoro-v1.0.onnx '$ModelUrl'
  echo '$ModelSha  /kokoro/kokoro-v1.0.onnx' | sha256sum -c -
fi
if ! check_voices; then
  echo 'Downloading voices-v1.0.bin...'
  curl -fL -o /kokoro/voices-v1.0.bin '$VoicesUrl'
  echo '$VoicesSha  /kokoro/voices-v1.0.bin' | sha256sum -c -
fi
echo 'Kokoro models verified.'
"@

# 7. Claude login guidance
if ($env:CLAUDE_CODE_OAUTH_TOKEN) {
    Write-Host "Saving CLAUDE_CODE_OAUTH_TOKEN to volume..." -ForegroundColor Green
    # Passed by name, so the token never appears in a command line or the process list.
    & $Engine run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v interview-room-claude:/home/node/.claude $ImageName sh -c 'umask 077; printenv CLAUDE_CODE_OAUTH_TOKEN > /home/node/.claude/oauth_token'
} else {
    Write-Host ""
    Write-Host "Claude authentication options:" -ForegroundColor Yellow
    Write-Host "1. Paste OAuth token from 'claude setup-token'"
    Write-Host "2. Or press Enter to start browser login inside container"
    $Token = Read-Host "Paste OAuth token (or press Enter)"
    if (-not [string]::IsNullOrWhiteSpace($Token)) {
        $env:CLAUDE_CODE_OAUTH_TOKEN = $Token
        & $Engine run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v interview-room-claude:/home/node/.claude $ImageName sh -c 'umask 077; printenv CLAUDE_CODE_OAUTH_TOKEN > /home/node/.claude/oauth_token'
        Remove-Item Env:CLAUDE_CODE_OAUTH_TOKEN
        Write-Host "OAuth token saved." -ForegroundColor Green
    } else {
        Write-Host "Starting Claude browser login in container..." -ForegroundColor Cyan
        & $Engine run -it --rm -v interview-room-claude:/home/node/.claude $ImageName claude login
    }
}

# 8. Save settings
$Port = if ($env:PORT) { $env:PORT } else { "4747" }
Set-Content -Path "$ScriptDir/.env" -Value @"
STUDY_ROOT=$StudyDir
PORT=$Port
IMAGE_NAME=$ImageName
CONTAINER_ENGINE=$Engine
"@

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "Run .\start.ps1 to start the server." -ForegroundColor Green
Write-Host "Open: http://127.0.0.1:$Port" -ForegroundColor Cyan
