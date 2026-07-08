#
# ResourceForge Antivirus Whitelist Setup
#
# This script automatically configures Windows Defender and Bitdefender
# to whitelist ResourceForge and its native modules (memoryjs).
#
# Usage:
#   Run as Administrator: powershell -ExecutionPolicy Bypass -File setup-antivirus-whitelist.ps1
#

param(
    [switch]$AutoConfirm = $false
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

# Detect ResourceForge installation
$resourceForgePaths = @(
    "$env:LOCALAPPDATA\Programs\ResourceForge\ResourceForge.exe",
    "C:\Program Files\ResourceForge\ResourceForge.exe",
    "$PSScriptRoot\..\dist-electron\dist\ResourceForge.exe"
)

$installPath = $null
foreach ($path in $resourceForgePaths) {
    if (Test-Path $path) {
        $installPath = $path
        break
    }
}

if (-not $installPath) {
    Write-Host "ERROR: ResourceForge not found in common install locations:" -ForegroundColor Red
    foreach ($path in $resourceForgePaths) {
        Write-Host "  - $path" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Please specify the path to ResourceForge.exe:" -ForegroundColor Yellow
    $installPath = Read-Host "Path"

    if (-not (Test-Path $installPath)) {
        Write-Host "ERROR: File not found: $installPath" -ForegroundColor Red
        exit 1
    }
}

Write-Host "Found ResourceForge at: $installPath" -ForegroundColor Green
Write-Host ""

# Get the directory containing ResourceForge
$resourceForgeDir = Split-Path $installPath -Parent
$distDir = Join-Path $resourceForgeDir "dist-electron"
$distElectronDir = Join-Path $resourceForgeDir "dist-electron\dist"

Write-Host "Configuration Paths:" -ForegroundColor Cyan
Write-Host "  - Main executable: $installPath"
Write-Host "  - AppData directory: $resourceForgeDir"
Write-Host "  - Build output: $distElectronDir"
Write-Host ""

if (-not $AutoConfirm) {
    $confirm = Read-Host "Proceed with antivirus whitelisting? (y/n)"
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

try {
    # Check if Windows Defender is available
    $defenderStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue

    if ($defenderStatus) {
        Write-Host "  Adding exclusions to Windows Defender..." -ForegroundColor Yellow

        # Add file exclusion
        Add-MpPreference -ExclusionPath $installPath -ErrorAction SilentlyContinue
        Write-Host "    ✓ Added file: $installPath" -ForegroundColor Green

        # Add directory exclusions
        Add-MpPreference -ExclusionPath $resourceForgeDir -ErrorAction SilentlyContinue
        Write-Host "    ✓ Added directory: $resourceForgeDir" -ForegroundColor Green

        # Add build output
        if (Test-Path $distElectronDir) {
            Add-MpPreference -ExclusionPath $distElectronDir -ErrorAction SilentlyContinue
            Write-Host "    ✓ Added build output: $distElectronDir" -ForegroundColor Green
        }

        Write-Host "  Windows Defender configured successfully" -ForegroundColor Green
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
    Write-Host "     - $installPath"
    Write-Host "     - $resourceForgeDir"
    if (Test-Path $distElectronDir) {
        Write-Host "     - $distElectronDir"
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
    Write-Host "    - $installPath"
    Write-Host "    - $resourceForgeDir"
}

# ============================================================================
# Verification
# ============================================================================

Write-Host ""
Write-Host "Verification:" -ForegroundColor Cyan

$exclusions = Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
if ($exclusions -contains $installPath) {
    Write-Host "  ✓ ResourceForge is whitelisted in Windows Defender" -ForegroundColor Green
} else {
    Write-Host "  ⚠ ResourceForge may not be whitelisted in Windows Defender" -ForegroundColor Yellow
}

# ============================================================================
# Summary
# ============================================================================

Write-Host ""
Write-Host "Setup Complete" -ForegroundColor Cyan
Write-Host "==============" -ForegroundColor Cyan
Write-Host ""
Write-Host "If you're still seeing antivirus warnings:" -ForegroundColor Yellow
Write-Host "  1. Make sure you've completed the Bitdefender manual steps above"
Write-Host "  2. Restart ResourceForge after adding exclusions"
Write-Host "  3. If warnings persist, disable real-time scanning temporarily"
Write-Host ""
Write-Host "For more information, see: ANTIVIRUS_SETUP.md" -ForegroundColor Cyan
Write-Host ""
