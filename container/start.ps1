# Sparmate Windows PowerShell Start Script
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $ScriptDir ".env"

$Engine = "podman"
if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    $Engine = "docker"
}

$Port = "4747"
$StudyDir = Join-Path $HOME "interview-prep"
$ImageName = "sparmate:latest"
$ContainerName = if ($env:CONTAINER_NAME) { $env:CONTAINER_NAME } else { "sparmate" }

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
  -e SPARMATE_IN_CONTAINER=1 `
  -e SPARMATE_FAKE_AGENT="$env:SPARMATE_FAKE_AGENT" `
  -v "${StudyDir}:/study" `
  -v "sparmate-data:/data" `
  -v "sparmate-kokoro:/kokoro" `
  -v "sparmate-claude:/home/node/.claude" `
  $ImageName | Out-Null

Write-Host "Sparmate is running at http://127.0.0.1:$Port" -ForegroundColor Cyan
