# Check whether the current network is good enough for GitHub Pages deployment.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-github-net.ps1
#
# Background: gh auth login (device flow) and git push both need github.com.
# On some mobile/carrier links that domain is intermittently dropped (SNI-level
# interference), while api.github.com stays fine. This script measures it.
#
# Note: the parameter is named $Target, not $Host - $Host is a read-only
# automatic variable in PowerShell and cannot be used as a parameter name.

$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Test-Target {
  param([string]$Target, [int]$Rounds = 5, [int]$TimeoutSec = 12)
  $ok = 0; $times = @(); $codes = @()
  foreach ($i in 1..$Rounds) {
    $out = curl.exe -sS -o NUL -w "%{http_code}|%{time_total}" --max-time $TimeoutSec "https://$Target/" 2>&1
    $parts = "$out" -split '\|'
    if ($parts.Count -eq 2 -and $parts[0] -match '^\d{3}$') {
      $ok++; $codes += $parts[0]; $times += [double]$parts[1]
    } else {
      $codes += 'FAIL'
    }
  }
  $avg = if ($times.Count) { [math]::Round((($times | Measure-Object -Average).Average), 2) } else { $null }
  return [pscustomobject]@{ Name = $Target; Ok = $ok; Rounds = $Rounds; Avg = $avg; Codes = ($codes -join ',') }
}

Write-Host ''
Write-Host '  GitHub connectivity check' -ForegroundColor Cyan
Write-Host '  -------------------------' -ForegroundColor Cyan
Write-Host ''

$results = @()
foreach ($t in @('github.com', 'api.github.com')) {
  Write-Host "  testing $t ..." -ForegroundColor Gray
  $results += Test-Target -Target $t
}

Write-Host ''
Write-Host '  Result:' -ForegroundColor Cyan
foreach ($r in $results) {
  $ratio = "$($r.Ok)/$($r.Rounds)"
  $color = if ($r.Ok -eq $r.Rounds) { 'Green' } elseif ($r.Ok -ge 3) { 'Yellow' } else { 'Red' }
  $avgText = if ($r.Avg) { "$($r.Avg)s" } else { 'n/a' }
  Write-Host ("    {0,-18} ok {1,-6} avg {2,-8} codes[{3}]" -f $r.Name, $ratio, $avgText, $r.Codes) -ForegroundColor $color
}

$gh = ($results | Where-Object { $_.Name -eq 'github.com' })
$api = ($results | Where-Object { $_.Name -eq 'api.github.com' })

Write-Host ''
if ($gh.Ok -eq $gh.Rounds -and $api.Ok -eq $api.Rounds) {
  Write-Host '  VERDICT: network is fine for deployment. Run:' -ForegroundColor Green
  Write-Host '    gh auth login'
  Write-Host '    gh repo create quiz-app --public --source=. --remote=origin --push'
} elseif ($gh.Ok -ge 3) {
  Write-Host '  VERDICT: github.com is flaky. It can work, but expect retries.' -ForegroundColor Yellow
  Write-Host '    - just run gh auth login again if it fails; usually succeeds within 2-4 tries'
  Write-Host '    - or switch network (connect WiFi/broadband) and run this check again'
} else {
  Write-Host '  VERDICT: github.com is basically unreachable right now - deployment will keep failing.' -ForegroundColor Red
  Write-Host '    Options:'
  Write-Host '      1) switch network (connect WiFi/broadband), then run this check again'
  Write-Host '      2) start a proxy, then set $env:HTTPS_PROXY and retry'
  Write-Host '    Note: api.github.com being fine is NOT enough - device flow and git push need github.com.'
}

Write-Host ''
Write-Host '  This script is read-only; it changes nothing.' -ForegroundColor Gray
Write-Host ''
