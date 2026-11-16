# Shared helpers for scripts/vm/*.ps1
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

function Import-VmEnv {
  $envFile = Join-Path $RepoRoot ".env"
  if (-not (Test-Path $envFile)) {
    throw "Нет $envFile — добавь VM_HOST, VM_USER, VM_SSH_KEY"
  }
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $key = $line.Substring(0, $i).Trim()
    $val = $line.Substring($i + 1).Trim()
    if ($key -match "^VM_") {
      Set-Item -Path "Env:$key" -Value $val
    }
  }
  foreach ($req in @("VM_HOST", "VM_USER", "VM_SSH_KEY")) {
    if (-not (Get-Item "Env:$req" -ErrorAction SilentlyContinue).Value) {
      throw "В .env не задан $req"
    }
  }
  if (-not (Test-Path $env:VM_SSH_KEY)) {
    throw "SSH-ключ не найден: $env:VM_SSH_KEY"
  }
}

function Get-VmSshArgs {
  @(
    "-i", $env:VM_SSH_KEY,
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "IdentitiesOnly=yes",
    "-o", "ServerAliveInterval=30"
  )
}

function Invoke-VmSsh {
  param(
    [Parameter(Mandatory = $true)][string]$RemoteCommand,
    [int]$TimeoutSec = 0
  )
  $sshArgs = (Get-VmSshArgs) + @("$($env:VM_USER)@$($env:VM_HOST)", $RemoteCommand)
  & ssh @sshArgs
  if ($LASTEXITCODE -ne 0) {
    throw "ssh failed ($LASTEXITCODE): $RemoteCommand"
  }
}

function Copy-VmFile {
  param(
    [Parameter(Mandatory = $true)][string]$LocalPath,
    [Parameter(Mandatory = $true)][string]$RemotePath
  )
  $scpArgs = (Get-VmSshArgs) + @($LocalPath, "$($env:VM_USER)@$($env:VM_HOST):$RemotePath")
  & scp @scpArgs
  if ($LASTEXITCODE -ne 0) {
    throw "scp failed: $LocalPath -> $RemotePath"
  }
}

function Copy-FromVmFile {
  param(
    [Parameter(Mandatory = $true)][string]$RemotePath,
    [Parameter(Mandatory = $true)][string]$LocalPath
  )
  $localDir = Split-Path $LocalPath -Parent
  if ($localDir -and -not (Test-Path $localDir)) {
    New-Item -ItemType Directory -Force -Path $localDir | Out-Null
  }
  $scpArgs = (Get-VmSshArgs) + @("$($env:VM_USER)@$($env:VM_HOST):$RemotePath", $LocalPath)
  & scp @scpArgs
  if ($LASTEXITCODE -ne 0) {
    throw "scp failed: $RemotePath -> $LocalPath"
  }
}

$AppDir = "/opt/emberfall"
$AppUser = "ubuntu"
$VmDbName = "l_fight_db"
