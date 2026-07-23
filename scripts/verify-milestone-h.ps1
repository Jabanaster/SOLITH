$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

$StartedAt = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$ReportDir = "Docs\Reports"
$ReportPath = Join-Path $ReportDir "MILESTONE_H_GATE_$StartedAt.txt"

if (!(Test-Path $ReportDir)) {
  New-Item -ItemType Directory -Path $ReportDir | Out-Null
}

function Log-Section {
  param([string]$Name)
  Write-Host ""
  Write-Host "============================================================"
  Write-Host $Name
  Write-Host "============================================================"
}

function Run-Gate {
  param([string]$Command)

  Log-Section "RUNNING: $Command"
  cmd /c $Command

  if ($LASTEXITCODE -ne 0) {
    throw "FAILED: $Command exited with code $LASTEXITCODE"
  }

  Write-Host "PASS: $Command"
}

Start-Transcript -Path $ReportPath -Force

try {
  Log-Section "REPO STATE"
  git status --short
  git branch --show-current
  git log --oneline -5

  Log-Section "VERIFY MILESTONE H FILES EXIST"

  $RequiredFiles = @(
    "src/core/game-profiles/index.ts",
    "src/core/game-profiles/loader.ts",
    "src/core/game-profiles/transform.ts",
    "src/core/game-profiles/types.ts",
    "src/core/game-profiles/profiles/stardew-valley.json",
    "tests/game-profile.test.ts"
  )

  foreach ($file in $RequiredFiles) {
    if (!(Test-Path $file)) {
      throw "Missing required Milestone H file: $file"
    }
    Write-Host "OK: $file"
  }

  Log-Section "RUN REQUIRED GATES"

  $Commands = @(
    "npx tsc --noEmit",
    "npm run test:game-profile",
    "npm run test:trainer-schema",
    "npm run test:trainer-host",
    "npm test",
    "npm run build:electron",
    "npm run build",
    "node scripts/validate-packaged-host.mjs",
    "node scripts/orphan-check.mjs",
    "npm run test:milestone-e"
  )

  foreach ($cmd in $Commands) {
    Run-Gate $cmd
  }

  Log-Section "PROFILE CONTENT CHECKS"

  $profilePath = "src/core/game-profiles/profiles/stardew-valley.json"
  $profileRaw = Get-Content $profilePath -Raw

  $RequiredStrings = @(
    "SaveGame.player.0.money",
    "SaveGame.player.0.stamina.0.float.0",
    "SaveGame.player.0.experiencePoints.0.int.0",
    "Money",
    "Stamina",
    "Farming XP",
    "God Mode",
    "Aim Assist"
  )

  foreach ($text in $RequiredStrings) {
    if ($profileRaw -notlike "*$text*") {
      throw "Profile missing expected text: $text"
    }
    Write-Host "OK profile contains: $text"
  }

  Log-Section "SPAWN FIX CHECK"

  $supervisorPath = "src/core/trainer-host/host-supervisor.ts"
  if (!(Test-Path $supervisorPath)) {
    throw "Missing TrainerHost supervisor: $supervisorPath"
  }

  $supervisor = Get-Content $supervisorPath -Raw

  $SpawnRequired = @(
    "process.execPath",
    "shell: false",
    "ELECTRON_RUN_AS_NODE",
    "app.asar.unpacked"
  )

  foreach ($text in $SpawnRequired) {
    if ($supervisor -notlike "*$text*") {
      throw "host-supervisor missing expected spawn safety text: $text"
    }
    Write-Host "OK host-supervisor contains: $text"
  }

  Log-Section "PACKAGED HOST FILE CHECK"

  $PackagedHost = "dist\win-unpacked\resources\app.asar.unpacked\dist-electron\host-entry.js"

  if (!(Test-Path $PackagedHost)) {
    throw "Packaged host-entry.js missing: $PackagedHost"
  }

  Write-Host "OK packaged host exists: $PackagedHost"

  Log-Section "MILESTONE H GATES PASSED"
  Write-Host "FINAL_STATUS=ACCEPTED"
  Write-Host "REPORT_PATH=$ReportPath"
}
catch {
  Log-Section "MILESTONE H GATE FAILURE"
  Write-Host "FINAL_STATUS=ACCEPTANCE_PENDING"
  Write-Host "ERROR=$($_.Exception.Message)"
  Write-Host "REPORT_PATH=$ReportPath"
  exit 1
}
finally {
  Stop-Transcript
}
