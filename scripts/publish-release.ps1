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
function Invoke-Checked {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE). Publishing stopped." }
}
function Invoke-Git {
  param([string[]]$GitArguments)
  # Use gh's authenticated credentials for this invocation only; do not edit global Git config.
  Invoke-Checked 'git' (@('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential') + $GitArguments)
}
Push-Location $repoRoot
try {
  Invoke-Checked 'gh' @('api', 'user', '--jq', '.login')
  $branch = & git branch --show-current
  if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne 'main') { throw 'Switch to the main branch before publishing.' }
  $origin = & git remote get-url origin
  if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^https://github[.]com/InukaWijerathna/SRM_Suite(?:[.]git)?/?$') { throw 'The origin remote is not the expected SRM_Suite repository.' }
  Invoke-Checked 'git' @('diff', '--check')
  $status = @(& git status --porcelain=v1 --untracked-files=all)
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Git status.' }
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
  $behind = & git rev-list --count HEAD..origin/main
  if ($LASTEXITCODE -ne 0 -or [int]$behind -ne 0) { throw 'Remote main has changes not in this checkout. Review and integrate them before publishing; no merge was attempted.' }
  # Refuse to overwrite any release that already exists.
  & gh release view $releaseTag --repo $githubRepo --json url 2>$null
  if ($LASTEXITCODE -eq 0) { throw 'This release already exists. No release assets will be overwritten.' }

  Invoke-Checked 'git' (@('add', '--') + $expectedFiles)
  & git diff --cached --quiet
  if ($LASTEXITCODE -eq 1) {
    Invoke-Checked 'git' @('commit', '-m', 'Release v0.3.0-beta with authenticated access and mobile navigation updates')
  } elseif ($LASTEXITCODE -ne 0) { throw 'Could not inspect staged changes.' }
  $headSha = & git rev-parse HEAD
  $existingTag = & git rev-parse --verify "refs/tags/$releaseTag^{commit}" 2>$null
  if ($LASTEXITCODE -eq 0) {
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
