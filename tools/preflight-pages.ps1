# Pre-flight check before deploying this project to GitHub Pages.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\preflight-pages.ps1
#
# It changes nothing - it only reads state and prints what to do next.

param(
  [string]$RepoName = 'quiz-app'
)

$ErrorActionPreference = 'Continue'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Write-Bad  { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }
function Write-Info { param($m) Write-Host "         $m" -ForegroundColor Gray }

Write-Host ''
Write-Host '  GitHub Pages deployment pre-flight' -ForegroundColor Cyan
Write-Host '  ----------------------------------' -ForegroundColor Cyan

# --- 1. project location -----------------------------------------------------
Write-Host ''
Write-Host '  [1] Project repository' -ForegroundColor Cyan
$proj = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $proj '.git'))) {
  Write-Bad "not a git repository: $proj"
  exit 1
}
Push-Location $proj
Write-Ok "git repository: $proj"

$branch = git branch --show-current
if ($branch -eq 'main') { Write-Ok 'branch is main' } else { Write-Warn "current branch is '$branch' (Pages workflow triggers on main)" }

$commits = (git rev-list --count HEAD 2>$null)
if ($commits -and [int]$commits -gt 0) { Write-Ok "$commits commit(s) ready to push" } else { Write-Bad 'no commits yet' }

$dirty = git status --porcelain
if ($dirty) { Write-Warn 'working tree has uncommitted changes (they will NOT be pushed)' } else { Write-Ok 'working tree clean' }

$remote = git remote
if ($remote) { Write-Warn "remote already exists: $($remote -join ', ') - skip 'git remote add origin', just 'git push -u origin main'" }
else { Write-Ok 'no remote yet (gh repo create will add it)' }

$wf = Join-Path $proj '.github\workflows\deploy-pages.yml'
if (Test-Path $wf) { Write-Ok 'Pages workflow present: .github/workflows/deploy-pages.yml' } else { Write-Warn 'Pages workflow missing' }

# --- 2. self test ------------------------------------------------------------
Write-Host ''
Write-Host '  [2] Self test (same command the workflow runs before publishing)' -ForegroundColor Cyan
$out = node scripts/check.mjs 2>&1
if ($LASTEXITCODE -eq 0) {
  $summary = ($out | Where-Object { $_ -match '\S' } | Select-Object -Last 1)
  if (-not $summary) { $summary = 'self test passed' }
  Write-Ok ('self test: ' + $summary.Trim())
} else {
  Write-Bad 'self test failed - the workflow would refuse to publish'
  $out | Select-String 'x ' | ForEach-Object { Write-Info $_.Line.Trim() }
}

Pop-Location

# --- 3. tooling --------------------------------------------------------------
Write-Host ''
Write-Host '  [3] Tooling' -ForegroundColor Cyan
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) { Write-Ok "gh found: $($gh.Source)" } else { Write-Bad 'gh (GitHub CLI) not found - install it first'; exit 1 }

$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) { Write-Ok "git found: $($git.Source)" } else { Write-Bad 'git not found'; exit 1 }

$auth = gh auth status 2>&1 | Out-String
if ($auth -match 'Logged in to') {
  Write-Ok 'gh is logged in'
  ($auth -split "`n" | Where-Object { $_ -match 'account|Logged in' }) | ForEach-Object { Write-Info $_.Trim() }

  $user = (gh api user --jq '.login' 2>$null)
  if ($user) {
    Write-Info "GitHub user: $user"
    $exists = gh api "repos/$user/$RepoName" --jq '.full_name' 2>$null
    if ($LASTEXITCODE -eq 0 -and $exists) {
      Write-Warn "repository '$user/$RepoName' already exists - pick another name or push into the existing one:"
      Write-Info "gh repo create $RepoName --public --source=. --remote=origin --push   <-- will FAIL, name taken"
      Write-Info "git remote add origin https://github.com/$user/$RepoName.git ; git push -u origin main   <-- use this instead"
    } else {
      Write-Ok "repository name '$RepoName' is available"
      Write-Info "your site will be: https://$user.github.io/$RepoName/"
    }
  }
} else {
  Write-Warn 'gh is NOT logged in yet - run: gh auth login'
  Write-Info 'choose: GitHub.com -> HTTPS -> Login with a web browser -> paste the one-time code'
}

# --- 4. network --------------------------------------------------------------
Write-Host ''
Write-Host '  [4] Network (only these two hosts matter for Pages)' -ForegroundColor Cyan
foreach ($h in @('github.com', 'api.github.com')) {
  $code = curl.exe -sS -o NUL -w '%{http_code}' --max-time 10 "https://$h/" 2>&1
  if ($code -match '^\d{3}$') { Write-Ok "$h reachable ($code)" } else { Write-Bad "$h NOT reachable" }
}
$blocked = curl.exe -sS -o NUL -w '%{http_code}' --max-time 6 'https://release-assets.githubusercontent.com/' 2>&1
if ($blocked -match '^\d{3}$') { Write-Info 'release-assets.githubusercontent.com reachable' }
else { Write-Info 'release-assets.githubusercontent.com blocked (irrelevant for Pages - only Release downloads need it)' }

# --- 5. next steps -----------------------------------------------------------
Write-Host ''
Write-Host '  Next steps' -ForegroundColor Cyan
Write-Host '    1) gh auth login                       (skip if already logged in)'
Write-Host "    2) gh repo create $RepoName --public --source=. --remote=origin --push"
Write-Host '    3) gh repo view --web                  then Settings -> Pages -> Source = GitHub Actions'
Write-Host ''
