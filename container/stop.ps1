# Interview Room Windows PowerShell Stop Script
$ErrorActionPreference = "SilentlyContinue"

$Engine = "podman"
if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    $Engine = "docker"
}

$ContainerName = if ($env:CONTAINER_NAME) { $env:CONTAINER_NAME } else { "interview-room" }

Write-Host "Stopping $ContainerName..." -ForegroundColor Yellow
& $Engine stop $ContainerName | Out-Null
& $Engine rm -f $ContainerName | Out-Null
Write-Host "Stopped." -ForegroundColor Green
