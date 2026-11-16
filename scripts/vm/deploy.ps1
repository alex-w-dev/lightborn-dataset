# Deploy dataset stack packages into /opt/emberfall (merge, do not wipe other stacks).
# Usage: pwsh scripts/vm/deploy.ps1
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\common.ps1"
Import-VmEnv

Write-Host "==> pnpm build"
Push-Location $RepoRoot
try {
  pnpm --filter @l-fight/dataset build
  if ($LASTEXITCODE -ne 0) { throw "dataset build failed" }
  pnpm --filter @l-fight/dataset-api build
  if ($LASTEXITCODE -ne 0) { throw "dataset-api build failed" }
  pnpm --filter @l-fight/dataset-ui exec vite build
  if ($LASTEXITCODE -ne 0) { throw "dataset-ui build failed" }
} finally {
  Pop-Location
}

$stage = Join-Path $RepoRoot "tmp\vm-deploy"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$copyMap = @(
  @{ From = "packages\dataset\package.json"; To = "packages\dataset\package.json" },
  @{ From = "packages\dataset\dist"; To = "packages\dataset\dist" },
  @{ From = "packages\dataset\src\generated"; To = "packages\dataset\src\generated" },
  @{ From = "packages\dataset-api\package.json"; To = "packages\dataset-api\package.json" },
  @{ From = "packages\dataset-api\dist"; To = "packages\dataset-api\dist" },
  @{ From = "packages\dataset-ui\package.json"; To = "packages\dataset-ui\package.json" },
  @{ From = "packages\dataset-ui\dist"; To = "packages\dataset-ui\dist" }
)

foreach ($item in $copyMap) {
  $src = Join-Path $RepoRoot $item.From
  $dst = Join-Path $stage $item.To
  if (-not (Test-Path $src)) { throw "Missing: $src" }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  if (Test-Path $src -PathType Container) {
    Copy-Item -Recurse -Force $src $dst
  } else {
    Copy-Item -Force $src $dst
  }
}

$archive = Join-Path $RepoRoot "tmp\dataset-deploy.tar.gz"
if (Test-Path $archive) { Remove-Item -Force $archive }
Push-Location $stage
try {
  & tar -czf $archive *
  if ($LASTEXITCODE -ne 0) { throw "tar failed" }
} finally {
  Pop-Location
}

Invoke-VmSsh "mkdir -p /tmp/dataset-upload '$AppDir'"
Copy-VmFile $archive "/tmp/dataset-upload/dataset-deploy.tar.gz"

$remote = @"
set -euo pipefail
sudo mkdir -p '$AppDir/packages'
sudo chown -R $($env:VM_USER):$($env:VM_USER) '$AppDir'
rm -rf /tmp/dataset-stage
mkdir -p /tmp/dataset-stage
tar -xzf /tmp/dataset-upload/dataset-deploy.tar.gz -C /tmp/dataset-stage
for pkg in dataset dataset-api dataset-ui; do
  rm -rf '$AppDir/packages/'\$pkg
  mv /tmp/dataset-stage/packages/\$pkg '$AppDir/packages/'\$pkg
done
echo 'Dataset packages updated'
"@
$remoteUnix = ($remote -replace "`r`n", "`n") -replace "`r", "`n"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remoteUnix))
Invoke-VmSsh "echo $b64 | base64 -d | bash"
Write-Host "Dataset deploy OK"
