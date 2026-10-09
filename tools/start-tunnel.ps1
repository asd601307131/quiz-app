# Start a temporary public tunnel so a phone on mobile data can open the local quiz app.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\start-tunnel.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\start-tunnel.ps1 -Port 5173
#
# Prerequisites:
#   1) local static server already running   (npm run dev)
#   2) cloudflared.exe placed in one of the locations listed below
#
# Notes: this is a Cloudflare Quick Tunnel - the URL changes on every start,
#        and it dies with this process / this PC. For long-term use deploy to GitHub Pages.

param(
  [int]$Port = 5213
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$candidates = @(
  "$env:USERPROFILE\cloudflared.exe",
  "$env:USERPROFILE\Downloads\cloudflared.exe",
  "$env:USERPROFILE\Downloads\cloudflared-windows-amd64.exe",
  "$env:USERPROFILE\Desktop\cloudflared.exe",
  "$env:USERPROFILE\Desktop\cloudflared-windows-amd64.exe",
  "$PSScriptRoot\cloudflared.exe"
)

Write-Host ''
Write-Host '  [1/3] Looking for cloudflared.exe ...' -ForegroundColor Cyan
$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) {
  Write-Host '  NOT FOUND. Put cloudflared.exe in one of these places:' -ForegroundColor Yellow
  $candidates | ForEach-Object { Write-Host "    $_" }
  exit 1
}
$sizeMB = [math]::Round((Get-Item $exe).Length / 1MB, 2)
Write-Host "  found: $exe  ($sizeMB MB)" -ForegroundColor Green
if ($sizeMB -lt 30) {
  Write-Host '  WARNING: file looks too small (expected ~52 MB) - download may be incomplete.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host '  [2/3] Verifying binary and local server ...' -ForegroundColor Cyan
$sig = Get-AuthenticodeSignature $exe
Write-Host "  signature: $($sig.Status)"
if ($sig.SignerCertificate) { Write-Host "  signer:    $($sig.SignerCertificate.Subject)" }
if ($sig.Status -ne 'Valid') {
  Write-Host '  WARNING: signature is not valid. Expected "Valid" and signer "Cloudflare, Inc.". Do not run untrusted files.' -ForegroundColor Yellow
}

try {
  $ver = & $exe --version 2>&1 | Select-Object -First 1
  Write-Host "  version:   $ver"
} catch {
  Write-Host "  cannot execute the file (corrupted or blocked by security software): $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if (-not $listening) {
  Write-Host "  nothing is listening on port $Port. Start it first in another terminal: npm run dev $Port" -ForegroundColor Red
  exit 1
}
Write-Host "  port $Port is listening" -ForegroundColor Green

Write-Host ''
Write-Host '  [3/3] Starting tunnel - keep this window open, press Ctrl+C to stop' -ForegroundColor Cyan
Write-Host '  A https://xxxx.trycloudflare.com address will appear below in a few seconds.' -ForegroundColor Gray
Write-Host '  Open that address on your phone (mobile data is fine).' -ForegroundColor Gray
Write-Host ''
& $exe tunnel --url "http://localhost:$Port"
