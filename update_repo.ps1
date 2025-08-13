# Update the local SpaghettiDiagramApp repository
# Usage: Right-click > Run with PowerShell (or run: ./update_repo.ps1)
# This script will:
#  1. Mark this directory safe (useful for OneDrive / different owner situations)
#  2. Fetch latest changes
#  3. Show local status and divergence summary
#  4. Pull latest from origin/master if fast-forward (no local uncommitted changes)

$ErrorActionPreference = 'Stop'

$repoPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "==> Repo path: $repoPath" -ForegroundColor Cyan

# 1. Ensure safe directory (in case of ownership mismatch under OneDrive)
Write-Host "==> Marking as safe.directory (if not already)" -ForegroundColor Cyan
git config --global --add safe.directory "$repoPath" | Out-Null

# 2. Fetch
Write-Host "==> Fetching origin" -ForegroundColor Cyan
pushd $repoPath | Out-Null
git fetch --all --prune

$currentBranch = git branch --show-current
if (-not $currentBranch) { $currentBranch = 'master' }

Write-Host "==> Current branch: $currentBranch" -ForegroundColor Green

# 3. Status & divergence
$status = git status --short --branch
Write-Host "==> Status:" -ForegroundColor Cyan
Write-Host $status

$localHash = git rev-parse $currentBranch
$remoteHash = git rev-parse origin/$currentBranch

if ($localHash -eq $remoteHash) {
    Write-Host "==> Local branch is up to date with origin/$currentBranch" -ForegroundColor Green
} else {
    Write-Host "==> Local ($localHash) differs from origin/$currentBranch ($remoteHash)" -ForegroundColor Yellow
    Write-Host "==> Showing commit graph (last 15 commits):" -ForegroundColor Cyan
    git log --oneline --decorate --graph -15 $currentBranch..origin/$currentBranch
}

# 4. Pull if clean & fast-forward possible
$hasLocalChanges = (git status --porcelain | Measure-Object).Count -gt 0
if (-not $hasLocalChanges) {
    Write-Host "==> Attempting fast-forward pull" -ForegroundColor Cyan
    git pull --ff-only origin $currentBranch || Write-Host "(Fast-forward not possible; manual merge/rebase needed)" -ForegroundColor Yellow
} else {
    Write-Host "==> Uncommitted changes present; skipping auto-pull." -ForegroundColor Yellow
}

popd | Out-Null
Write-Host "==> Done." -ForegroundColor Green
