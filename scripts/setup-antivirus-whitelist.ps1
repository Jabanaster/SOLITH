#
# ResourceForge Antivirus Whitelist Setup
#
# This script automatically configures Windows Defender and Bitdefender
# to whitelist ResourceForge and its native modules (memoryjs).
#
# Two modes:
#   1. Installed-app mode (default) - whitelists an installed ResourceForge.exe
#      and its containing directory. This is what you want after running the
#      full installer.
#   2. Dev/build-output mode - whitelists only the pre-package build output
#      folders (dist, dist-electron) used while developing/building locally,
#      before an installer exists. Use this if electron-builder's packaging
#      step (npm run build) fails with a Windows EPERM/rename error caused by
#      antivirus real-time scanning of freshly-unpacked Electron binaries.
#
# Usage:
#   Run as Administrator: powershell -ExecutionPolicy Bypass -File setup-antivirus-whitelist.ps1
#   Dev/build-output mode (non-interactive): powershell -ExecutionPolicy Bypass -File setup-antivirus-whitelist.ps1 -DevBuildOutput
#

param(
    [switch]$AutoConfirm = $false,
    [switch]$DevBuildOutput = $false
)

# Check if running as Administrator
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Please right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "ResourceForge Antivirus Whitelist Setup" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
# Mode selection
# ============================================================================
# $mode is either "installed" (whitelist a real ResourceForge.exe + its
# directory) or "devbuild" (whitelist only this repo's dist/dist-electron
# build-output folders, narrowly, before an installer exists).

$mode = $null
$installPath = $null
$resourceForgeDir = $null
$distElectronDir = $null

# The two build-output folders this repo's build actually writes to.
# Hardcoded relative to the script's own location so this never resolves
# outside this repo, regardless of $AutoConfirm/$DevBuildOutput usage.
$devDistDir = Join-Path $PSScriptRoot "..\dist" | Resolve-Path -ErrorAction SilentlyContinue
$devDistElectronDir = Join-Path $PSScriptRoot "..\dist-electron" | Resolve-Path -ErrorAction SilentlyContinue
if (-not $devDistDir) { $devDistDir = Join-Path $PSScriptRoot "..\dist" }
if (-not $devDistElectronDir) { $devDistElectronDir = Join-Path $PSScriptRoot "..\dist-electron" }

if ($DevBuildOutput) {
    # Non-interactive: caller explicitly asked for dev/build-output mode.
    $mode = "devbuild"
} else {
    # Detect an installed ResourceForge.exe first (existing behavior, preserved).
    $resourceForgePaths = @(
        "$env:LOCALAPPDATA\Programs\ResourceForge\ResourceForge.exe",
        "C:\Program Files\ResourceForge\ResourceForge.exe",
        "$PSScriptRoot\..\dist-electron\dist\ResourceForge.exe"
    )

    foreach ($path in $resourceForgePaths) {
        if (Test-Path $path) {
            $installPath = $path
            break
        }
    }

    if ($installPath) {
        $mode = "installed"
    } else {
        Write-Host "ResourceForge not found in common install locations:" -ForegroundColor Yellow
        foreach ($path in $resourceForgePaths) {
            Write-Host "  - $path" -ForegroundColor Yellow
        }
        Write-Host ""
        Write-Host "No installed app found. Choose what to whitelist:" -ForegroundColor Cyan
        Write-Host "  1. Specify a path to ResourceForge.exe (installed-app mode)"
        Write-Host "  2. Whitelist this repo's dev/build-output folders only (dist, dist-electron)"
        Write-Host "  3. Cancel"
        Write-Host ""
        $choice = Read-Host "Choice (1/2/3)"

        switch ($choice) {
            "1" {
                Write-Host ""
                Write-Host "Please specify the path to ResourceForge.exe:" -ForegroundColor Yellow
                $installPath = Read-Host "Path"
                if (-not (Test-Path $installPath)) {
                    Write-Host "ERROR: File not found: $installPath" -ForegroundColor Red
                    exit 1
                }
                $mode = "installed"
            }
            "2" {
                $mode = "devbuild"
            }
            default {
                Write-Host "Cancelled." -ForegroundColor Yellow
                exit 0
            }
        }
    }
}

# ============================================================================
# Resolve exclusion paths for the selected mode
# ============================================================================

$exclusionPaths = @()

if ($mode -eq "installed") {
    $resourceForgeDir = Split-Path $installPath -Parent
    $distElectronDir = Join-Path $resourceForgeDir "dist-electron\dist"

    Write-Host ""
    Write-Host "Found ResourceForge at: $installPath" -ForegroundColor Green
    Write-Host ""
    Write-Host "Configuration Paths (installed-app mode):" -ForegroundColor Cyan
    Write-Host "  - Main executable: $installPath"
    Write-Host "  - AppData directory: $resourceForgeDir"
    if (Test-Path $distElectronDir) {
        Write-Host "  - Build output: $distElectronDir"
    }
    Write-Host ""

    $exclusionPaths += $installPath
    $exclusionPaths += $resourceForgeDir
    if (Test-Path $distElectronDir) {
        $exclusionPaths += $distElectronDir
    }
} else {
    Write-Host ""
    Write-Host "Configuration Paths (dev/build-output mode):" -ForegroundColor Cyan
    Write-Host "  - $devDistDir"
    Write-Host "  - $devDistElectronDir"
    Write-Host ""
    Write-Host "This mode does NOT whitelist an installed application - only the" -ForegroundColor Yellow
    Write-Host "above two build-output folders used while developing locally." -ForegroundColor Yellow
    Write-Host ""

    $exclusionPaths += $devDistDir.ToString()
    $exclusionPaths += $devDistElectronDir.ToString()
}

if (-not $AutoConfirm) {
    $confirm = Read-Host "Proceed with antivirus whitelisting for the path(s) above? (y/n)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Cancelled." -ForegroundColor Yellow
        exit 0
    }
}

# ============================================================================
# Windows Defender Configuration
# ============================================================================

Write-Host ""
Write-Host "Configuring Windows Defender..." -ForegroundColor Cyan

# Tracks real outcome across this whole section so later messages (the
# immediate summary below, and the final Setup Complete summary) can never
# claim success when Add-MpPreference actually failed for every path.
$defenderAvailable = $false
$defenderAddSucceededCount = 0
$defenderAddFailedCount = 0

try {
    # Check if Windows Defender is available
    $defenderStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue

    if ($defenderStatus) {
        $defenderAvailable = $true
        Write-Host "  Adding exclusions to Windows Defender..." -ForegroundColor Yellow

        foreach ($exclusionPath in $exclusionPaths) {
            try {
                Add-MpPreference -ExclusionPath $exclusionPath -ErrorAction Stop
                Write-Host "    ✓ Added: $exclusionPath" -ForegroundColor Green
                $defenderAddSucceededCount++
            } catch {
                Write-Host "    ✗ FAILED to add: $exclusionPath ($_)" -ForegroundColor Red
                $defenderAddFailedCount++
            }
        }

        if ($defenderAddFailedCount -eq 0 -and $defenderAddSucceededCount -gt 0) {
            if ($mode -eq "installed") {
                Write-Host "  Windows Defender configured successfully (installed application)" -ForegroundColor Green
            } else {
                Write-Host "  Windows Defender configured successfully (dev/build-output folders only)" -ForegroundColor Green
            }
        } elseif ($defenderAddSucceededCount -gt 0) {
            Write-Host "  Windows Defender partially configured: $defenderAddSucceededCount succeeded, $defenderAddFailedCount failed" -ForegroundColor Yellow
        } else {
            Write-Host "  Windows Defender exclusions FAILED - no paths were whitelisted" -ForegroundColor Red
            Write-Host "  This usually means Windows Defender is disabled, unavailable, or is not" -ForegroundColor Red
            Write-Host "  the active antivirus provider on this machine (a third-party AV may have" -ForegroundColor Red
            Write-Host "  taken over and disabled Defender's own preference/WMI provider)." -ForegroundColor Red
        }
    } else {
        Write-Host "  Windows Defender not detected (may be using third-party antivirus)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  WARNING: Could not configure Windows Defender: $_" -ForegroundColor Yellow
}

# ============================================================================
# Bitdefender Configuration
# ============================================================================

Write-Host ""
Write-Host "Configuring Bitdefender..." -ForegroundColor Cyan

# Check if Bitdefender is installed
$bitdefenderPaths = @(
    "C:\Program Files\Bitdefender\Bitdefender Internet Security",
    "C:\Program Files (x86)\Bitdefender\Bitdefender Internet Security",
    "C:\Program Files\Bitdefender Total Security",
    "C:\Program Files (x86)\Bitdefender Total Security"
)

$bitdefenderFound = $false
foreach ($path in $bitdefenderPaths) {
    if (Test-Path $path) {
        $bitdefenderFound = $true
        break
    }
}

if ($bitdefenderFound) {
    Write-Host "  Bitdefender detected" -ForegroundColor Green
    Write-Host ""
    Write-Host "  MANUAL STEPS REQUIRED:" -ForegroundColor Yellow
    Write-Host "  1. Open Bitdefender Total Security"
    Write-Host "  2. Go to: Settings → Protection → Exclusions"
    Write-Host "  3. Click 'Add exclusion' and select:"
    foreach ($exclusionPath in $exclusionPaths) {
        Write-Host "     - $exclusionPath"
    }
    Write-Host ""
    Write-Host "  4. Toggle 'Advanced Exclusions' and add process names:"
    Write-Host "     - ResourceForge.exe"
    Write-Host "     - memoryjs"
    Write-Host ""
    Write-Host "  5. Click 'Apply' to save changes"
    Write-Host ""
} else {
    Write-Host "  Bitdefender not detected" -ForegroundColor Yellow
    Write-Host "  If you're using Bitdefender, please manually whitelist:" -ForegroundColor Yellow
    foreach ($exclusionPath in $exclusionPaths) {
        Write-Host "    - $exclusionPath"
    }
}

# ============================================================================
# Verification
# ============================================================================

Write-Host ""
Write-Host "Verification:" -ForegroundColor Cyan

$allVerified = $false
try {
    $exclusions = Get-MpPreference -ErrorAction Stop | Select-Object -ExpandProperty ExclusionPath
    $allVerified = $true
    foreach ($exclusionPath in $exclusionPaths) {
        if ($exclusions -contains $exclusionPath) {
            Write-Host "  ✓ Whitelisted in Windows Defender: $exclusionPath" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ May not be whitelisted in Windows Defender: $exclusionPath" -ForegroundColor Yellow
            $allVerified = $false
        }
    }
} catch {
    Write-Host "  ✗ Could not verify exclusions - Windows Defender preference provider is unavailable ($_)" -ForegroundColor Red
}

# ============================================================================
# Summary
# ============================================================================

Write-Host ""
if ($defenderAddSucceededCount -gt 0 -and $defenderAddFailedCount -eq 0) {
    Write-Host "Setup Complete" -ForegroundColor Cyan
    Write-Host "==============" -ForegroundColor Cyan
    Write-Host ""
    if ($mode -eq "installed") {
        Write-Host "The installed ResourceForge application was whitelisted." -ForegroundColor Green
    } else {
        Write-Host "Only this repo's dev/build-output folders (dist, dist-electron) were" -ForegroundColor Green
        Write-Host "whitelisted. The application itself has not been installed or whitelisted." -ForegroundColor Green
    }
} else {
    Write-Host "Setup Did NOT Complete" -ForegroundColor Red
    Write-Host "======================" -ForegroundColor Red
    Write-Host ""
    Write-Host "No antivirus exclusions were successfully applied." -ForegroundColor Red
    if (-not $defenderAvailable) {
        Write-Host "Windows Defender was not detected as available on this machine." -ForegroundColor Red
    } else {
        Write-Host "Windows Defender was detected, but every Add-MpPreference call failed" -ForegroundColor Red
        Write-Host "($defenderAddFailedCount of $($defenderAddSucceededCount + $defenderAddFailedCount) path(s))." -ForegroundColor Red
        Write-Host "This typically means a third-party antivirus is the active provider and" -ForegroundColor Red
        Write-Host "Defender's own preference/WMI provider is disabled or unreachable." -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Do not assume the build-output folders are whitelisted. If you use a" -ForegroundColor Yellow
    Write-Host "third-party antivirus, follow its manual exclusion steps (see below/" -ForegroundColor Yellow
    Write-Host "ANTIVIRUS_SETUP.md) instead of relying on this script." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "If you're still seeing antivirus warnings:" -ForegroundColor Yellow
Write-Host "  1. Make sure you've completed the Bitdefender manual steps above"
Write-Host "  2. Restart ResourceForge (or re-run the build) after adding exclusions"
Write-Host "  3. If warnings persist, disable real-time scanning temporarily"
Write-Host ""
Write-Host "For more information, see: ANTIVIRUS_SETUP.md" -ForegroundColor Cyan
Write-Host ""
