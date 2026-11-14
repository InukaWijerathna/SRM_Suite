# Run from your own authenticated PowerShell terminal, outside the Codex sandbox.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseTag = 'v0.3.0-beta'
$githubRepo = 'InukaWijerathna/SRM_Suite'
$releaseDir = Join-Path $repoRoot '.tools/releases/v0.3.0-beta'
$expectedFiles = @(
  'README.md', 'SECURITY_ASSESSMENT.md', 'android/app/build.gradle',
  'apps-script/Code.gs', 'package.json', 'package-lock.json',
  'src/App.tsx', 'src/components/AccountDrawer.tsx',
  'src/components/AttendanceList.tsx', 'src/components/BottomNav.tsx',
  'src/components/Header.tsx', 'src/components/Login.tsx',
  'src/components/Settings.tsx', 'src/components/StudentDirectory.tsx',
  'src/components/SyncBar.tsx', 'src/context/AppContext.tsx',
  'src/index.css', 'src/services/api.ts', 'src/services/storage.ts',
  'src/types/index.ts', 'tests/auth-harness.mjs', 'tests/auth.test.mjs',
  'docs/releases/v0.3.0-beta.md', 'scripts/publish-release.ps1'
)
function Invoke-NativeResult {
  param([string]$Program, [string[]]$Arguments)
  Get-Command $Program -ErrorAction Stop | Out-Null
  $errorFile = [System.IO.Path]::GetTempFileName()
  try {
    # Windows PowerShell 5.1 treats native stderr as ErrorRecord objects. Capture it
    # separately and use the exit code, so harmless Git progress is not fatal.
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $outputLines = @(& $Program @Arguments 2>$errorFile)
    $exitCode = $LASTEXITCODE
    $errorText = Get-Content -LiteralPath $errorFile -Raw -ErrorAction SilentlyContinue
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $outputLines; ErrorText = $errorText }
  } finally {
    Remove-Item -LiteralPath $errorFile -Force -ErrorAction SilentlyContinue
  }
}
function Invoke-Checked {
  param([string]$Program, [string[]]$Arguments)
  $result = Invoke-NativeResult $Program $Arguments
  if ($result.ErrorText) { Write-Host $result.ErrorText.TrimEnd() }
  if ($result.ExitCode -ne 0) { throw "$Program failed (exit $($result.ExitCode)). Publishing stopped." }
  $result.Output | Write-Output
}
function Invoke-Git {
  param([string[]]$GitArguments)
  # Use gh's authenticated credentials for this invocation only; do not edit global Git config.
  Invoke-Checked 'git' (@('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential') + $GitArguments)
}
Push-Location $repoRoot
try {
  Invoke-Checked 'gh' @('api', 'user', '--jq', '.login')
  $branch = (Invoke-Checked 'git' @('branch', '--show-current'))
  if ($branch.Trim() -ne 'main') { throw 'Switch to the main branch before publishing.' }
  $origin = Invoke-Checked 'git' @('remote', 'get-url', 'origin')
  if ($origin -notmatch '^https://github[.]com/InukaWijerathna/SRM_Suite(?:[.]git)?/?$') { throw 'The origin remote is not the expected SRM_Suite repository.' }
  Invoke-Checked 'git' @('diff', '--check')
  $status = @(Invoke-Checked 'git' @('status', '--porcelain=v1', '--untracked-files=all'))
  foreach ($line in $status) {
    if (-not $line) { continue }
    $name = $line.Substring(3).Replace('\', '/')
    if ($expectedFiles -notcontains $name) { throw "Unexpected changed file: $name. Review it before publishing; nothing has been staged." }
  }

  $notesFile = Join-Path $repoRoot 'docs/releases/v0.3.0-beta.md'
  $sumFile = Join-Path $releaseDir 'SHA256SUMS.txt'
  if (-not (Test-Path -LiteralPath $notesFile) -or -not (Test-Path -LiteralPath $sumFile)) { throw 'Release notes or checksums are missing.' }
  $assets = @()
  foreach ($line in Get-Content -LiteralPath $sumFile) {
    if ($line -notmatch '^([a-fA-F0-9]{64})  ([A-Za-z0-9._-]+)$') { throw 'Malformed checksum entry.' }
    $expectedHash = $Matches[1]
    $assetName = $Matches[2]
    $assetPath = Join-Path $releaseDir $assetName
    if (-not (Test-Path -LiteralPath $assetPath)) { throw "Missing artifact: $assetName" }
    if ((Get-FileHash -LiteralPath $assetPath -Algorithm SHA256).Hash -ne $expectedHash) { throw "Checksum mismatch: $assetName" }
    $assets += $assetPath
  }
  if ($assets.Count -ne 4) { throw 'Expected three APK variants and one source archive.' }
  $assets += $sumFile

  Invoke-Git @('fetch', 'origin', 'main')
  $behind = Invoke-Checked 'git' @('rev-list', '--count', 'HEAD..origin/main')
  if ([int]$behind -ne 0) { throw 'Remote main has changes not in this checkout. Review and integrate them before publishing; no merge was attempted.' }
  # Listing succeeds even when this tag has no release; avoid an expected 404.
  $releaseTags = @(Invoke-Checked 'gh' @('api', "repos/$githubRepo/releases?per_page=100", '--paginate', '--jq', '.[].tag_name'))
  if ($releaseTags -contains $releaseTag) { throw 'This release already exists. No release assets will be overwritten.' }

  Invoke-Checked 'git' (@('add', '--') + $expectedFiles)
  $stagedFiles = @(Invoke-Checked 'git' @('diff', '--cached', '--name-only'))
  if ($stagedFiles.Count -gt 0) {
    Invoke-Checked 'git' @('commit', '-m', 'Release v0.3.0-beta with authenticated access and mobile navigation updates')
  }
  $headSha = Invoke-Checked 'git' @('rev-parse', 'HEAD')
  $matchingTags = @(Invoke-Checked 'git' @('tag', '--list', $releaseTag))
  if ($matchingTags -contains $releaseTag) {
    $existingTag = Invoke-Checked 'git' @('rev-parse', "refs/tags/$releaseTag^{commit}")
    if ($existingTag -ne $headSha) { throw 'The local tag points to a different commit. No tag was overwritten.' }
  } else {
    Invoke-Checked 'git' @('tag', '-a', $releaseTag, '-m', 'SRM Suite v0.3.0-beta')
  }
  Invoke-Git @('push', 'origin', 'HEAD:main')
  Invoke-Git @('push', 'origin', "refs/tags/$releaseTag")
  Invoke-Checked 'gh' (@('release', 'create', $releaseTag, '--repo', $githubRepo, '--verify-tag', '--prerelease', '--title', 'SRM Suite v0.3.0-beta', '--notes-file', $notesFile) + $assets)
  Write-Host "Published https://github.com/$githubRepo/releases/tag/$releaseTag"
} finally {
  Pop-Location
}
