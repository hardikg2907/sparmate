# Interview Room Windows PowerShell Start Script
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $ScriptDir ".env"

$Engine = "podman"
if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    $Engine = "docker"
}

$Port = "4747"
$StudyDir = Join-Path $HOME "interview-prep"
$ImageName = "interview-room:latest"
$ContainerName = if ($env:CONTAINER_NAME) { $env:CONTAINER_NAME } else { "interview-room" }

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line.Split("=", 2)
            if ($parts.Length -eq 2) {
                switch ($parts[0]) {
                    "STUDY_ROOT" { $StudyDir = $parts[1] }
                    "PORT" { $Port = $parts[1] }
                    "IMAGE_NAME" { $ImageName = $parts[1] }
                    "CONTAINER_ENGINE" { $Engine = $parts[1] }
                }
            }
        }
    }
}

& $Engine rm -f $ContainerName 2>$null | Out-Null

Write-Host "Starting $ContainerName on http://127.0.0.1:$Port..." -ForegroundColor Green

& $Engine run -d `
  --name $ContainerName `
  -p "127.0.0.1:${Port}:${Port}" `
  -e PORT="$Port" `
  -e IR_IN_CONTAINER=1 `
  -e IR_FAKE_AGENT="$env:IR_FAKE_AGENT" `
  -v "${StudyDir}:/study" `
  -v "interview-room-data:/data" `
  -v "interview-room-kokoro:/kokoro" `
  -v "interview-room-claude:/home/node/.claude" `
  $ImageName | Out-Null

Write-Host "Interview Room is running at http://127.0.0.1:$Port" -ForegroundColor Cyan
