# Usage:
#   pwsh scripts/vm/ssh.ps1
#   pwsh scripts/vm/ssh.ps1 -- "uptime"
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$RemoteCommand
)

. "$PSScriptRoot\common.ps1"
Import-VmEnv

$target = "$($env:VM_USER)@$($env:VM_HOST)"
$sshArgs = Get-VmSshArgs
if ($RemoteCommand -and $RemoteCommand.Count -gt 0) {
  $cmd = ($RemoteCommand -join " ").Trim()
  if ($cmd.StartsWith("-- ")) { $cmd = $cmd.Substring(3) }
  elseif ($cmd.StartsWith("--")) { $cmd = $cmd.Substring(2).Trim() }
  & ssh @sshArgs $target $cmd
  exit $LASTEXITCODE
}

& ssh @sshArgs $target
exit $LASTEXITCODE
