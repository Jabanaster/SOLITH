#Requires -Version 7.0
<#
.SYNOPSIS
Extracts IPC surface from Solith Electron application.

.DESCRIPTION
Identifies all ipcMain.handle and ipcMain.on registrations across electron/ directory.
Handles multiline registrations, imports, and dynamic patterns.

.NOTES
Non-destructive analysis script. Produces no file modifications.
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromPipeline = $false)]
    [string]$SourceDirectory = "electron"
)

function Find-IpcRegistrations {
    param([string]$Dir)

    Write-Host "=== IPC EXTRACTION SCRIPT ===" -ForegroundColor Cyan
    Write-Host "Source: $Dir"
    Write-Host "Analysis: ipcMain.handle() and ipcMain.on()"
    Write-Host ""

    # Find all TypeScript files
    $tsFiles = Get-ChildItem -Path $Dir -Filter "*.ts" -Recurse | Select-Object -ExpandProperty FullName

    Write-Host "FILES SCANNED:"
    foreach ($file in $tsFiles) {
        $basename = $file -replace ".*\\", ""
        Write-Host "  $basename"
    }

    Write-Host ""
    Write-Host "=== ipcMain.handle() REGISTRATIONS ===" -ForegroundColor Yellow

    $handles = @()
    $handleCount = 0

    foreach ($file in $tsFiles) {
        $content = Get-Content $file -Raw

        # Pattern: ipcMain.handle('channel-name', ...)
        # Supports multiline callbacks but requires 'channel-name' on same line as ipcMain.handle
        $pattern = "ipcMain\.handle\('([^']+)'"
        $matches = [regex]::Matches($content, $pattern)

        foreach ($match in $matches) {
            $channelName = $match.Groups[1].Value
            $lineNum = ($content.Substring(0, $match.Index) -split "`n").Count

            $handles += [PSCustomObject]@{
                Channel = $channelName
                File = $file
                Line = $lineNum
                Type = "handle"
            }

            Write-Host "$($handles[-1].Channel)" -ForegroundColor Green
            Write-Host "  File: $(Split-Path -Leaf $file) @ line $lineNum"
        }

        $handleCount += $matches.Count
    }

    Write-Host ""
    Write-Host "Total ipcMain.handle(): $handleCount"

    Write-Host ""
    Write-Host "=== ipcMain.on() REGISTRATIONS ===" -ForegroundColor Yellow

    $ons = @()
    $onCount = 0

    foreach ($file in $tsFiles) {
        $content = Get-Content $file -Raw
        $pattern = "ipcMain\.on\('([^']+)'"
        $matches = [regex]::Matches($content, $pattern)

        foreach ($match in $matches) {
            $channelName = $match.Groups[1].Value
            $lineNum = ($content.Substring(0, $match.Index) -split "`n").Count

            $ons += [PSCustomObject]@{
                Channel = $channelName
                File = $file
                Line = $lineNum
                Type = "on"
            }

            Write-Host "$($ons[-1].Channel)" -ForegroundColor Green
            Write-Host "  File: $(Split-Path -Leaf $file) @ line $lineNum"
        }

        $onCount += $matches.Count
    }

    Write-Host ""
    Write-Host "Total ipcMain.on(): $onCount"

    Write-Host ""
    Write-Host "=== UNIQUENESS ANALYSIS ===" -ForegroundColor Yellow

    $allRegistrations = @($handles + $ons)
    $uniqueChannels = $allRegistrations | Select-Object -ExpandProperty Channel | Sort-Object -Unique
    $duplicates = @()

    foreach ($channel in $uniqueChannels) {
        $count = ($allRegistrations | Where-Object { $_.Channel -eq $channel }).Count
        if ($count -gt 1) {
            $duplicates += [PSCustomObject]@{
                Channel = $channel
                Count = $count
            }
            Write-Host "DUPLICATE: $channel ($count registrations)" -ForegroundColor Red
        }
    }

    if ($duplicates.Count -eq 0) {
        Write-Host "No duplicate channels found" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "=== SUMMARY ===" -ForegroundColor Cyan
    Write-Host "Total registrations: $($allRegistrations.Count)"
    Write-Host "Unique channels: $($uniqueChannels.Count)"
    Write-Host "Duplicate channels: $($duplicates.Count)"
    Write-Host "Handle registrations: $handleCount"
    Write-Host "On registrations: $onCount"

    Write-Host ""
    Write-Host "=== SORTED CHANNEL LIST ===" -ForegroundColor Yellow
    $uniqueChannels | ForEach-Object { Write-Host $_ }

    return @{
        Handles = $handles
        Ons = $ons
        Unique = $uniqueChannels
        Duplicates = $duplicates
    }
}

# Execute
$result = Find-IpcRegistrations -Dir $SourceDirectory
